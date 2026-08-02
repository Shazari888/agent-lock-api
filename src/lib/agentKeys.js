const crypto = require("crypto");

const API_KEY_PREFIX = "ag_";
const DISPLAY_PREFIX_LENGTH = 14;

function generateApiKey() {
  return `${API_KEY_PREFIX}${crypto.randomBytes(24).toString("hex")}`;
}

function hashApiKey(apiKey) {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

function getApiKeyPrefix(apiKey) {
  return apiKey.slice(0, DISPLAY_PREFIX_LENGTH);
}

module.exports = {
  generateApiKey,
  getApiKeyPrefix,
  hashApiKey
};
