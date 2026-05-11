const express = require("express");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.static(__dirname));

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
