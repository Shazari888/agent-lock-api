const { createRuntimeDependencies } = require("./src/runtime");

const { app, config, maintenance } = createRuntimeDependencies();

maintenance.start();

app.listen(config.port, () => {
  console.log(`Agent Guard API listening at http://localhost:${config.port}`);
});
