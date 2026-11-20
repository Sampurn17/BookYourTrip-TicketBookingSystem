const mongoose = require('mongoose');

const PAYMENT_METHODS = ['card', 'upi', 'netbanking', 'wallet'];

const paymentSchema = new mongoose.Schema(
  {
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: ['charge', 'refund'], required: true },
    purpose: {
      type: String,
      enum: ['booking', 'reschedule', 'cancellation'],
      required: true,
    },
    amount: { type: Number, required: true, min: 0 },
    method: { type: String, enum: PAYMENT_METHODS },
    transactionId: { type: String, required: true, unique: true },
    status: { type: String, enum: ['success', 'failed'], default: 'success' },
    maskedInstrument: String,
  },
  { timestamps: true },
);

paymentSchema.index({ bookingId: 1 });

const Payment = mongoose.model('Payment', paymentSchema);

module.exports = { Payment, PAYMENT_METHODS };
