const mongoose = require('mongoose');

const passengerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    age: { type: Number, required: true, min: 0, max: 120 },
    gender: { type: String, enum: ['M', 'F', 'O'], required: true },
    seatNumber: { type: Number, required: true },
  },
  { _id: false },
);

const fareSchema = new mongoose.Schema(
  {
    basePrice: Number,
    multiplier: Number,
    perSeat: Number,
    total: Number,
    breakdown: [{ _id: false, rule: String, label: String, factor: Number }],
  },
  { _id: false },
);

const chargeSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['reschedule_fee', 'fare_difference', 'cancellation_fee'], required: true },
    amount: { type: Number, required: true, min: 0 },
    note: String,
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const historySchema = new mongoose.Schema(
  {
    action: { type: String, enum: ['booked', 'rescheduled', 'passengers_updated', 'cancelled'], required: true },
    by: { type: String, enum: ['customer', 'provider', 'admin', 'system'], default: 'customer' },
    fromDate: String,
    toDate: String,
    amount: Number,
    note: String,
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const bookingSchema = new mongoose.Schema(
  {
    pnr: { type: String, required: true, unique: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    tripId: { type: mongoose.Schema.Types.ObjectId, ref: 'Trip', required: true },
    providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Provider', required: true },
    travelDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    originalTravelDate: { type: String },
    seatNumbers: { type: [Number], required: true },
    passengers: { type: [passengerSchema], required: true },
    fare: fareSchema,
    amountPaid: { type: Number, required: true, min: 0 },
    charges: [chargeSchema],
    totalPenalty: { type: Number, default: 0 },
    refundAmount: { type: Number, default: 0 },
    paymentMethod: { type: String },
    status: { type: String, enum: ['confirmed', 'cancelled'], default: 'confirmed' },
    cancelledBy: { type: String, enum: ['customer', 'provider', 'admin', 'system'] },
    cancellationReason: String,
    cancelledAt: Date,
    history: [historySchema],
    /** Client-generated key; replays of the same checkout return the original booking. */
    idempotencyKey: { type: String },
    /** Optimistic-lock counter for cancel/reschedule/edit. */
    version: { type: Number, default: 0 },
  },
  { timestamps: true },
);

bookingSchema.index({ customerId: 1, travelDate: -1 });
bookingSchema.index({ tripId: 1, travelDate: 1, status: 1 });
bookingSchema.index({ providerId: 1, createdAt: -1 });
bookingSchema.index(
  { customerId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);

const Booking = mongoose.model('Booking', bookingSchema);

module.exports = { Booking };
