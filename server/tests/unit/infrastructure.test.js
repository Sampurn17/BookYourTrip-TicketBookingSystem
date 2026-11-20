const AppError = require('../../src/utils/AppError');
const { errorHandler, notFoundHandler } = require('../../src/middleware/errorHandler');
const gateway = require('../../src/services/payment/mockGateway');
const payments = require('../../src/services/payment');
const tx = require('../../src/utils/transaction');

function mockRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  return res;
}

describe('AppError factories', () => {
  test('carry status codes and machine-readable codes', () => {
    expect(AppError.badRequest('x')).toMatchObject({ statusCode: 400, code: 'BAD_REQUEST' });
    expect(AppError.unauthorized()).toMatchObject({ statusCode: 401 });
    expect(AppError.forbidden()).toMatchObject({ statusCode: 403 });
    expect(AppError.notFound('Trip')).toMatchObject({ statusCode: 404, message: 'Trip not found' });
    expect(AppError.conflict('c', 'SEAT_UNAVAILABLE', { seats: [1] })).toMatchObject({ statusCode: 409, details: { seats: [1] } });
  });
});

describe('errorHandler', () => {
  const run = (err) => {
    const res = mockRes();
    errorHandler(err, {}, res, () => {});
    return res;
  };

  test('maps known error types to clean responses', () => {
    expect(run(AppError.conflict('taken', 'SEAT_UNAVAILABLE', { seats: [2] })).body).toEqual({
      status: 'error',
      code: 'SEAT_UNAVAILABLE',
      message: 'taken',
      details: { seats: [2] },
    });
    expect(run({ name: 'CastError', path: '_id' }).statusCode).toBe(400);
    expect(run({ name: 'ValidationError', errors: { a: { path: 'a', message: 'bad a' } } }).body).toMatchObject({ code: 'VALIDATION_ERROR', message: 'bad a' });
    expect(run({ code: 11000, keyPattern: { email: 1 } }).body).toMatchObject({ code: 'DUPLICATE', message: 'Duplicate value for email' });
    expect(run({ type: 'entity.parse.failed' }).body.code).toBe('BAD_JSON');
  });

  test('hides unexpected errors behind a 500', () => {
    const res = run(new Error('db exploded'));
    expect(res.statusCode).toBe(500);
    expect(res.body.code).toBe('INTERNAL_ERROR');
  });

  test('notFoundHandler forwards a 404 AppError', () => {
    let forwarded;
    notFoundHandler({ method: 'GET', originalUrl: '/nope' }, {}, (e) => {
      forwarded = e;
    });
    expect(forwarded).toMatchObject({ statusCode: 404, code: 'ROUTE_NOT_FOUND' });
  });
});

describe('mock payment gateway', () => {
  test('charges and masks instruments', async () => {
    const card = await gateway.charge({ amount: 100, method: 'card', details: { cardNumber: '4111111111111111' } });
    expect(card.transactionId).toMatch(/^PAY_/);
    expect(card.maskedInstrument).toBe('card **** 1111');
    expect((await gateway.charge({ amount: 5, method: 'upi', details: { upiId: 'asha@okaxis' } })).maskedInstrument).toBe('as***@okaxis');
    expect((await gateway.charge({ amount: 5, method: 'wallet' })).maskedInstrument).toBe('wallet');
  });

  test('declines test instruments and validates input', async () => {
    await expect(gateway.charge({ amount: 1, method: 'card', details: { cardNumber: '4111111111110000' } })).rejects.toMatchObject({ code: 'PAYMENT_DECLINED', statusCode: 402 });
    await expect(gateway.charge({ amount: 1, method: 'upi', details: { upiId: 'fail@upi' } })).rejects.toMatchObject({ code: 'PAYMENT_DECLINED' });
    await expect(gateway.charge({ amount: 1, method: 'card', details: {} })).rejects.toMatchObject({ statusCode: 422 });
    await expect(gateway.charge({ amount: 1, method: 'upi' })).rejects.toMatchObject({ statusCode: 422 });
    await expect(gateway.charge({ amount: -1, method: 'wallet' })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('refunds', async () => {
    expect((await gateway.refund({ amount: 10 })).transactionId).toMatch(/^RFD_/);
    await expect(gateway.refund({ amount: NaN })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('gateway factory can be swapped (test seam)', () => {
    const fake = { name: 'fake' };
    payments.setGateway(fake);
    expect(payments.getGateway()).toBe(fake);
    payments.setGateway(null);
    expect(payments.getGateway()).toBe(gateway);
  });
});

describe('runInTransaction without transactions (compensation path)', () => {
  afterEach(() => tx.setTransactionSupport(false));

  test('returns the result when every step succeeds', async () => {
    tx.setTransactionSupport(false);
    expect(tx.isTransactionSupported()).toBe(false);
    const out = await tx.runInTransaction(async (session, undo) => {
      expect(session).toBeNull();
      undo.push(async () => {
        throw new Error('should not run');
      });
      return 42;
    });
    expect(out).toBe(42);
  });

  test('runs compensations in reverse order when a step fails', async () => {
    const order = [];
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      tx.runInTransaction(async (_s, undo) => {
        undo.push(async () => order.push('release seats'));
        undo.push(async () => {
          order.push('delete booking');
          throw new Error('compensation failure is logged, not thrown');
        });
        throw new Error('payment failed');
      }),
    ).rejects.toThrow('payment failed');
    expect(order).toEqual(['delete booking', 'release seats']);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test('detectTransactionSupport honours explicit modes and failures', async () => {
    expect(await tx.detectTransactionSupport(null, 'false')).toBe(false);
    expect(await tx.detectTransactionSupport(null, 'true')).toBe(true);
    const broken = { db: { admin: () => ({ command: async () => { throw new Error('down'); } }) } };
    expect(await tx.detectTransactionSupport(broken, 'auto')).toBe(false);
    const replica = { db: { admin: () => ({ command: async () => ({ setName: 'rs0' }) }) } };
    expect(await tx.detectTransactionSupport(replica, 'auto')).toBe(true);
    const standalone = { db: { admin: () => ({ command: async () => ({}) }) } };
    expect(await tx.detectTransactionSupport(standalone)).toBe(false);
  });
});
