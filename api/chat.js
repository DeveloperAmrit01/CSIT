const { createServer } = require("../server");

const app = createServer({ isVercel: true });

module.exports = (request, response) => {
  app.emit("request", request, response);
};
