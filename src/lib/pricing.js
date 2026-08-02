const PRICING = {
  base: {
    read_usdc: 0.008,
    write_usdc: 0.009,
    delete_usdc: 0.005
  },
  premium: {
    dashboard_generation_usdc: 0.012,
    security_action_usdc: 0.012
  },
  memory_ttl_write_usdc: {
    ttl_24h: 0.009,
    ttl_7d: 0.012,
    ttl_custom_8d_to_30d: 0.014
  }
};

function getMemoryWritePriceUsdc(ttlHours) {
  if (ttlHours <= 24) {
    return PRICING.memory_ttl_write_usdc.ttl_24h;
  }

  if (ttlHours <= 24 * 7) {
    return PRICING.memory_ttl_write_usdc.ttl_7d;
  }

  return PRICING.memory_ttl_write_usdc.ttl_custom_8d_to_30d;
}

module.exports = {
  PRICING,
  getMemoryWritePriceUsdc
};
