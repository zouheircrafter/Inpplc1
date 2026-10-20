'use strict';
const path = require('path');
const { createApp } = require('./app');

const port = Number(process.env.PORT) || 3000;
const dataFile = process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'db.json');

const { server } = createApp({ dataFile });
server.listen(port, () => {
  console.log(`Ticketing démarré sur http://localhost:${port}`);
});
