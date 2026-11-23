const express = require('express');

const vehicleStatuses = new Set(['available', 'maintenance']);
const rentalStatuses = new Set(['reserved', 'active', 'completed', 'cancelled']);

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function text(value, label, max = 120, required = true) {
  const result = typeof value === 'string' ? value.trim() : '';
  if (required && !result) fail(400, `${label} é obrigatório.`);
  if (result.length > max) fail(400, `${label} deve ter até ${max} caracteres.`);
  return result;
}

function number(value, label, min, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) fail(400, `${label} inválido.`);
  return parsed;
}

function date(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(400, `${label} inválida.`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) fail(400, `${label} inválida.`);
  return value;
}

function id(value, label = 'Identificador') {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) fail(400, `${label} inválido.`);
  return parsed;
}

function router(database) {
  const api = express.Router();
  const run = (sql) => database.prepare(sql);

  function uniqueCheck(table, column, value, exceptId) {
    const row = exceptId
      ? database.prepare(`SELECT id FROM ${table} WHERE ${column} = ? AND id <> ?`).get(value, exceptId)
      : database.prepare(`SELECT id FROM ${table} WHERE ${column} = ?`).get(value);
    if (row) fail(409, `${column === 'plate' ? 'A placa' : 'O documento'} já está cadastrado.`);
  }

  function vehicleInput(body) {
    const value = {
      brand: text(body.brand, 'Marca', 60),
      model: text(body.model, 'Modelo', 80),
      year: number(body.year, 'Ano', 1950, new Date().getFullYear() + 2),
      plate: text(body.plate, 'Placa', 10).toUpperCase().replace(/\s/g, ''),
      category: text(body.category, 'Categoria', 40),
      daily_rate: number(body.daily_rate, 'Diária', 0, 1000000),
      status: body.status || 'available'
    };
    if (!/^[A-Z0-9-]{7,8}$/.test(value.plate)) fail(400, 'Informe uma placa válida.');
    if (!vehicleStatuses.has(value.status)) fail(400, 'Status do veículo inválido.');
    return value;
  }

  function clientInput(body) {
    const value = {
      name: text(body.name, 'Nome', 120),
      document: text(body.document, 'Documento', 30).replace(/[.\-/\s]/g, ''),
      email: text(body.email, 'E-mail', 160, false).toLowerCase(),
      phone: text(body.phone, 'Telefone', 30, false)
    };
    if (value.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email)) fail(400, 'Informe um e-mail válido.');
    if (!/^[A-Za-z0-9]{5,20}$/.test(value.document)) fail(400, 'Informe um documento válido (5 a 20 letras ou números).');
    return value;
  }

  function rentalInput(body, exceptId) {
    const vehicleId = id(body.vehicle_id, 'Veículo');
    const clientId = id(body.client_id, 'Cliente');
    const startDate = date(body.start_date, 'Data inicial');
    const endDate = date(body.end_date, 'Data final');
    if (endDate < startDate) fail(400, 'A data final deve ser igual ou posterior à inicial.');
    const vehicle = database.prepare('SELECT id, daily_rate, status FROM vehicles WHERE id = ?').get(vehicleId);
    if (!vehicle) fail(404, 'Veículo não encontrado.');
    if (vehicle.status !== 'available') fail(409, 'Este veículo está em manutenção.');
    if (!database.prepare('SELECT id FROM clients WHERE id = ?').get(clientId)) fail(404, 'Cliente não encontrado.');
    const conflict = database.prepare(`
      SELECT id FROM rentals
      WHERE vehicle_id = ? AND status IN ('reserved', 'active')
        AND start_date <= ? AND end_date >= ? AND id <> COALESCE(?, 0)
    `).get(vehicleId, endDate, startDate, exceptId || null);
    if (conflict) fail(409, 'O veículo já possui uma locação nesse período.');
    const status = body.status || 'reserved';
    if (!rentalStatuses.has(status)) fail(400, 'Status da locação inválido.');
    return { vehicle_id: vehicleId, client_id: clientId, start_date: startDate, end_date: endDate, daily_rate: vehicle.daily_rate, status };
  }

  function sendError(response, error) {
    const status = error.status || (String(error.message).includes('UNIQUE constraint failed') ? 409 : 500);
    const message = status === 500 ? 'Não foi possível concluir a operação.' : error.message;
    response.status(status).json({ error: message });
  }

  api.get('/dashboard', (_request, response) => {
    const totals = {
      vehicles: database.prepare('SELECT COUNT(*) AS total FROM vehicles').get().total,
      available: database.prepare("SELECT COUNT(*) AS total FROM vehicles WHERE status = 'available'").get().total,
      clients: database.prepare('SELECT COUNT(*) AS total FROM clients').get().total,
      activeRentals: database.prepare("SELECT COUNT(*) AS total FROM rentals WHERE status IN ('reserved', 'active')").get().total
    };
    const recent = database.prepare(`
      SELECT r.id, r.start_date, r.end_date, r.status, v.brand || ' ' || v.model AS vehicle,
             c.name AS client
      FROM rentals r JOIN vehicles v ON v.id = r.vehicle_id JOIN clients c ON c.id = r.client_id
      ORDER BY r.id DESC LIMIT 5
    `).all();
    response.json({ totals, recent });
  });

  api.get('/vehicles', (_request, response) => {
    response.json(database.prepare(`
      SELECT v.*, CASE WHEN EXISTS (
        SELECT 1 FROM rentals r WHERE r.vehicle_id = v.id AND r.status IN ('reserved','active')
          AND r.start_date <= date('now') AND r.end_date >= date('now')
      ) THEN 1 ELSE 0 END AS rented_today FROM vehicles v ORDER BY v.id DESC
    `).all());
  });
  api.post('/vehicles', (request, response) => {
    try {
      const value = vehicleInput(request.body);
      uniqueCheck('vehicles', 'plate', value.plate);
      const result = run('INSERT INTO vehicles (brand, model, year, plate, category, daily_rate, status) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(value.brand, value.model, value.year, value.plate, value.category, value.daily_rate, value.status);
      response.status(201).json(database.prepare('SELECT * FROM vehicles WHERE id = ?').get(result.lastInsertRowid));
    } catch (error) { sendError(response, error); }
  });
  api.put('/vehicles/:id', (request, response) => {
    try {
      const vehicleId = id(request.params.id);
      if (!database.prepare('SELECT id FROM vehicles WHERE id = ?').get(vehicleId)) fail(404, 'Veículo não encontrado.');
      const value = vehicleInput(request.body);
      uniqueCheck('vehicles', 'plate', value.plate, vehicleId);
      if (value.status === 'maintenance' && database.prepare("SELECT id FROM rentals WHERE vehicle_id = ? AND status IN ('reserved','active') LIMIT 1").get(vehicleId)) fail(409, 'Não é possível colocar em manutenção um veículo com locações abertas.');
      run('UPDATE vehicles SET brand=?, model=?, year=?, plate=?, category=?, daily_rate=?, status=? WHERE id=?')
        .run(value.brand, value.model, value.year, value.plate, value.category, value.daily_rate, value.status, vehicleId);
      response.json(database.prepare('SELECT * FROM vehicles WHERE id = ?').get(vehicleId));
    } catch (error) { sendError(response, error); }
  });
  api.delete('/vehicles/:id', (request, response) => {
    try {
      const vehicleId = id(request.params.id);
      if (!database.prepare('SELECT id FROM vehicles WHERE id = ?').get(vehicleId)) fail(404, 'Veículo não encontrado.');
      if (database.prepare('SELECT id FROM rentals WHERE vehicle_id = ? LIMIT 1').get(vehicleId)) fail(409, 'Este veículo possui locações vinculadas e não pode ser removido.');
      run('DELETE FROM vehicles WHERE id = ?').run(vehicleId);
      response.status(204).end();
    } catch (error) { sendError(response, error); }
  });

  api.get('/clients', (_request, response) => response.json(database.prepare('SELECT * FROM clients ORDER BY id DESC').all()));
  api.post('/clients', (request, response) => {
    try {
      const value = clientInput(request.body);
      uniqueCheck('clients', 'document', value.document);
      const result = run('INSERT INTO clients (name, document, email, phone) VALUES (?, ?, ?, ?)').run(value.name, value.document, value.email, value.phone);
      response.status(201).json(database.prepare('SELECT * FROM clients WHERE id = ?').get(result.lastInsertRowid));
    } catch (error) { sendError(response, error); }
  });
  api.put('/clients/:id', (request, response) => {
    try {
      const clientId = id(request.params.id);
      if (!database.prepare('SELECT id FROM clients WHERE id = ?').get(clientId)) fail(404, 'Cliente não encontrado.');
      const value = clientInput(request.body);
      uniqueCheck('clients', 'document', value.document, clientId);
      run('UPDATE clients SET name=?, document=?, email=?, phone=? WHERE id=?').run(value.name, value.document, value.email, value.phone, clientId);
      response.json(database.prepare('SELECT * FROM clients WHERE id = ?').get(clientId));
    } catch (error) { sendError(response, error); }
  });
  api.delete('/clients/:id', (request, response) => {
    try {
      const clientId = id(request.params.id);
      if (!database.prepare('SELECT id FROM clients WHERE id = ?').get(clientId)) fail(404, 'Cliente não encontrado.');
      if (database.prepare('SELECT id FROM rentals WHERE client_id = ? LIMIT 1').get(clientId)) fail(409, 'Este cliente possui locações vinculadas e não pode ser removido.');
      run('DELETE FROM clients WHERE id = ?').run(clientId);
      response.status(204).end();
    } catch (error) { sendError(response, error); }
  });

  api.get('/rentals', (_request, response) => response.json(database.prepare(`
    SELECT r.*, v.brand || ' ' || v.model AS vehicle, v.plate,
           c.name AS client, (julianday(r.end_date) - julianday(r.start_date) + 1) * r.daily_rate AS total
    FROM rentals r JOIN vehicles v ON v.id = r.vehicle_id JOIN clients c ON c.id = r.client_id ORDER BY r.id DESC
  `).all()));
  api.get('/rentals/options', (_request, response) => response.json({
    vehicles: database.prepare("SELECT id, brand || ' ' || model AS label, plate, daily_rate FROM vehicles WHERE status = 'available' ORDER BY brand, model").all(),
    clients: database.prepare('SELECT id, name AS label FROM clients ORDER BY name').all()
  }));
  api.post('/rentals', (request, response) => {
    try {
      const value = rentalInput(request.body);
      const result = run('INSERT INTO rentals (vehicle_id, client_id, start_date, end_date, daily_rate, status) VALUES (?, ?, ?, ?, ?, ?)')
        .run(value.vehicle_id, value.client_id, value.start_date, value.end_date, value.daily_rate, value.status);
      response.status(201).json(database.prepare('SELECT * FROM rentals WHERE id = ?').get(result.lastInsertRowid));
    } catch (error) { sendError(response, error); }
  });
  api.put('/rentals/:id', (request, response) => {
    try {
      const rentalId = id(request.params.id);
      if (!database.prepare('SELECT id FROM rentals WHERE id = ?').get(rentalId)) fail(404, 'Locação não encontrada.');
      const value = rentalInput(request.body, rentalId);
      run('UPDATE rentals SET vehicle_id=?, client_id=?, start_date=?, end_date=?, daily_rate=?, status=? WHERE id=?')
        .run(value.vehicle_id, value.client_id, value.start_date, value.end_date, value.daily_rate, value.status, rentalId);
      response.json(database.prepare('SELECT * FROM rentals WHERE id = ?').get(rentalId));
    } catch (error) { sendError(response, error); }
  });
  api.delete('/rentals/:id', (request, response) => {
    try {
      const rentalId = id(request.params.id);
      if (!database.prepare('SELECT id FROM rentals WHERE id = ?').get(rentalId)) fail(404, 'Locação não encontrada.');
      run('DELETE FROM rentals WHERE id = ?').run(rentalId);
      response.status(204).end();
    } catch (error) { sendError(response, error); }
  });

  api.use((error, _request, response, _next) => {
    sendError(response, error);
  });
  return api;
}

module.exports = { createApiRouter: router };
