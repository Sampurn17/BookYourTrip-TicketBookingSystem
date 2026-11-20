const bookingService = require('../services/bookingService');

exports.create = async (req, res) => {
  const key = req.get('Idempotency-Key');
  const idempotencyKey = key && key.length <= 100 ? key : undefined;
  const { booking, replayed } = await bookingService.createBooking(req.user, req.validated.body, { idempotencyKey });
  const full = await bookingService.getCustomerBooking(req.user._id, booking._id);
  res.status(replayed ? 200 : 201).json({ status: 'success', replayed, booking: full });
};

exports.list = async (req, res) => {
  const bookings = await bookingService.listCustomerBookings(req.user._id, req.validated.query.scope);
  res.json({ status: 'success', count: bookings.length, bookings });
};

exports.get = async (req, res) => {
  res.json({ status: 'success', booking: await bookingService.getCustomerBooking(req.user._id, req.validated.params.id) });
};

exports.cancelQuote = async (req, res) => {
  res.json({ status: 'success', quote: await bookingService.cancellationQuote(req.user._id, req.validated.params.id) });
};

exports.cancel = async (req, res) => {
  const result = await bookingService.cancelBooking({
    bookingId: req.validated.params.id,
    userId: req.user._id,
    actor: 'customer',
    reason: req.validated.body.reason,
  });
  const booking = await bookingService.getCustomerBooking(req.user._id, result.booking._id);
  res.json({ status: 'success', refund: result.refund, fee: result.fee, booking });
};

exports.rescheduleQuote = async (req, res) => {
  const quote = await bookingService.rescheduleQuote(req.user._id, req.validated.params.id, req.validated.body.newDate);
  res.json({ status: 'success', quote });
};

exports.reschedule = async (req, res) => {
  const { newDate, payment } = req.validated.body;
  const result = await bookingService.rescheduleBooking(req.user._id, req.validated.params.id, newDate, payment);
  res.json({ status: 'success', ...result });
};

exports.updatePassengers = async (req, res) => {
  const booking = await bookingService.updatePassengers(req.user._id, req.validated.params.id, req.validated.body.passengers);
  res.json({ status: 'success', booking });
};
