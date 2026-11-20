/**
 * Dummy payment gateway (Adapter). A real gateway (Razorpay/Stripe) would
 * implement the same `charge` / `refund` interface.
 *
 * Deterministic test hooks so declines can be demoed:
 *   - card numbers ending in 0000 are declined
 *   - UPI id "fail@upi" is declined
 */
const crypto = require('crypto');
const AppError = require('../../utils/AppError');

const txnId = (prefix) => `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`.toUpperCase();

function mask(method, details = {}) {
  if (method === 'card' && details.cardNumber) return `card **** ${details.cardNumber.slice(-4)}`;
  if (method === 'upi' && details.upiId) return details.upiId.replace(/^(.{2}).*(@.*)$/, '$1***$2');
  return method;
}

const mockGateway = {
  name: 'mock',

  async charge({ amount, method, details = {} }) {
    if (!(amount >= 0)) throw AppError.badRequest('Invalid amount');
    if (method === 'card' && !details.cardNumber) {
      throw new AppError('Card number is required', 422, 'VALIDATION_ERROR');
    }
    if (method === 'upi' && !details.upiId) throw new AppError('UPI id is required', 422, 'VALIDATION_ERROR');

    const declined =
      (method === 'card' && details.cardNumber.endsWith('0000')) || (method === 'upi' && details.upiId === 'fail@upi');
    if (declined) {
      throw new AppError('Payment was declined by the bank. No money was deducted.', 402, 'PAYMENT_DECLINED');
    }
    return { transactionId: txnId('PAY'), status: 'success', maskedInstrument: mask(method, details) };
  },

  async refund({ amount }) {
    if (!(amount >= 0)) throw AppError.badRequest('Invalid refund amount');
    return { transactionId: txnId('RFD'), status: 'success' };
  },
};

module.exports = mockGateway;
