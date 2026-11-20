const request = require('supertest');
const jwt = require('jsonwebtoken');
const { createApp } = require('../../src/app');
const { startDB, clearDB, stopDB } = require('../helpers/db');
const { createCustomer } = require('../helpers/factory');

let app;
beforeAll(async () => {
  await startDB();
  app = createApp();
});
afterEach(clearDB);
afterAll(stopDB);

describe('Auth API', () => {
  test('customer signup returns a token and never leaks the password', async () => {
    const res = await request(app).post('/api/auth/signup').send({ name: 'Asha Rao', email: 'ASHA@x.com', password: 'secret12' });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user).toMatchObject({ name: 'Asha Rao', email: 'asha@x.com', role: 'customer' });
    expect(res.body.user.password).toBeUndefined();
  });

  test('rejects duplicate emails and invalid payloads', async () => {
    await request(app).post('/api/auth/signup').send({ name: 'Asha', email: 'a@x.com', password: 'secret12' });
    const dup = await request(app).post('/api/auth/signup').send({ name: 'Asha', email: 'a@x.com', password: 'secret12' });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('EMAIL_TAKEN');

    const bad = await request(app).post('/api/auth/signup').send({ name: 'A', email: 'nope', password: '1' });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('VALIDATION_ERROR');
    expect(bad.body.details.length).toBeGreaterThan(1);
  });

  test('provider signup starts in pending state (onboarding needs admin approval)', async () => {
    const res = await request(app)
      .post('/api/auth/signup')
      .send({ name: 'Ravi', email: 'ops@zing.com', password: 'secret12', role: 'provider', companyName: 'Zing', servicesOffered: ['bus'] });
    expect(res.status).toBe(201);
    expect(res.body.user.provider).toMatchObject({ companyName: 'Zing', status: 'pending', servicesOffered: ['bus'] });
  });

  test('login succeeds with the right password only', async () => {
    await request(app).post('/api/auth/signup').send({ name: 'Asha', email: 'a@x.com', password: 'secret12' });
    const ok = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'secret12' });
    expect(ok.status).toBe(200);
    expect(ok.body.user.email).toBe('a@x.com');

    const wrong = await request(app).post('/api/auth/login').send({ email: 'a@x.com', password: 'nope' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
    const unknown = await request(app).post('/api/auth/login').send({ email: 'ghost@x.com', password: 'nope' });
    expect(unknown.status).toBe(401);
  });

  test('protected routes require a valid token', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    const bad = await request(app).get('/api/auth/me').set('Authorization', 'Bearer garbage');
    expect(bad.status).toBe(401);
    expect(bad.body.code).toBe('INVALID_TOKEN');

    const expired = jwt.sign({ id: '507f1f77bcf86cd799439011' }, process.env.JWT_SECRET, { expiresIn: -10 });
    const exp = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${expired}`);
    expect(exp.body.message).toMatch(/expired/);

    const orphan = jwt.sign({ id: '507f1f77bcf86cd799439011' }, process.env.JWT_SECRET);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${orphan}`)).status).toBe(401);

    const { token, user } = await createCustomer();
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.user._id).toBe(String(user._id));
  });

  test('role based access control', async () => {
    const { token } = await createCustomer();
    const res = await request(app).get('/api/admin/stats').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    const prov = await request(app).get('/api/provider/trips').set('Authorization', `Bearer ${token}`);
    expect(prov.status).toBe(403);
  });

  test('profile can be edited', async () => {
    const { token } = await createCustomer();
    const res = await request(app).patch('/api/users/me').set('Authorization', `Bearer ${token}`).send({ name: 'New Name', phone: '9876543210' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ name: 'New Name', phone: '9876543210' });

    const bad = await request(app).patch('/api/users/me').set('Authorization', `Bearer ${token}`).send({ phone: '123' });
    expect(bad.status).toBe(422);
    const empty = await request(app).patch('/api/users/me').set('Authorization', `Bearer ${token}`).send({});
    expect(empty.status).toBe(422);
  });

  test('changing the password invalidates older tokens', async () => {
    const { user } = await createCustomer();
    const oldToken = jwt.sign({ id: String(user._id), iat: Math.floor(Date.now() / 1000) - 60 }, process.env.JWT_SECRET);

    const wrong = await request(app).patch('/api/users/me/password').set('Authorization', `Bearer ${oldToken}`).send({ currentPassword: 'bad', newPassword: 'newpass1' });
    expect(wrong.status).toBe(401);

    const res = await request(app)
      .patch('/api/users/me/password')
      .set('Authorization', `Bearer ${oldToken}`)
      .send({ currentPassword: 'Password@123', newPassword: 'newpass1' });
    expect(res.status).toBe(200);

    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${oldToken}`)).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`)).status).toBe(200);
    expect((await request(app).post('/api/auth/login').send({ email: user.email, password: 'newpass1' })).status).toBe(200);
  });
});

describe('App plumbing', () => {
  test('health check reports DB and transaction support', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'connected', transactions: true });
  });

  test('unknown routes and malformed JSON return clean errors', async () => {
    const nf = await request(app).get('/api/nope');
    expect(nf.status).toBe(404);
    expect(nf.body.code).toBe('ROUTE_NOT_FOUND');
    expect((await request(app).get('/not-api')).status).toBe(404);

    const bad = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":');
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('BAD_JSON');
  });

  test('invalid object ids are rejected before hitting the database', async () => {
    const res = await request(app).get('/api/trips/123');
    expect(res.status).toBe(422);
  });
});
