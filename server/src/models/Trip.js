const mongoose = require('mongoose');
const { MODES } = require('./Provider');
const { durationMinutes } = require('../utils/dates');

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

/** A recurring service (e.g. "Delhi -> Jaipur, 08:30 daily"). Seats are tracked per date in DailyAvailability. */
const tripSchema = new mongoose.Schema(
  {
    providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Provider', required: true },
    mode: { type: String, enum: MODES, required: true },
    serviceName: { type: String, trim: true, maxlength: 60 },
    source: { type: String, required: true, trim: true, maxlength: 50 },
    destination: { type: String, required: true, trim: true, maxlength: 50 },
    sourceNorm: { type: String, index: true },
    destinationNorm: { type: String },
    departureTime: { type: String, required: true, match: TIME_RE },
    arrivalTime: { type: String, required: true, match: TIME_RE },
    durationMinutes: { type: Number },
    basePrice: { type: Number, required: true, min: 1, max: 100000 },
    totalSeats: { type: Number, required: true, min: 1, max: 300 },
    operatingDays: {
      type: [{ type: Number, min: 0, max: 6 }],
      default: () => [...ALL_DAYS],
    },
    amenities: [{ type: String, trim: true, maxlength: 30 }],
    status: { type: String, enum: ['scheduled', 'cancelled'], default: 'scheduled' },
  },
  { timestamps: true },
);

tripSchema.index({ sourceNorm: 1, destinationNorm: 1, status: 1 });
tripSchema.index({ providerId: 1, status: 1 });

tripSchema.pre('validate', function normalise() {
  if (this.source) this.sourceNorm = this.source.trim().toLowerCase();
  if (this.destination) this.destinationNorm = this.destination.trim().toLowerCase();
  if (this.departureTime && this.arrivalTime && TIME_RE.test(this.departureTime) && TIME_RE.test(this.arrivalTime)) {
    this.durationMinutes = durationMinutes(this.departureTime, this.arrivalTime);
  }
});

const Trip = mongoose.model('Trip', tripSchema);

module.exports = { Trip, ALL_DAYS };
