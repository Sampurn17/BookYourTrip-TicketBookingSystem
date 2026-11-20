/** Payment gateway factory - one place to swap the mock for a real provider. */
const mockGateway = require('./mockGateway');

let gateway = mockGateway;

module.exports = {
  getGateway: () => gateway,
  /** Test seam */
  setGateway: (g) => {
    gateway = g || mockGateway;
  },
};
