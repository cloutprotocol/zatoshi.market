import { query } from "./_generated/server";

export const getPlatformConfig = query({
  args: {},
  handler: async () => {
    const enabled = (process.env.PLATFORM_FEE_ENABLED || '').toLowerCase() === 'true';
    const zats = parseInt(process.env.PLATFORM_FEE_ZATS || '100000', 10);
    const treasury = process.env.PLATFORM_TREASURY_ADDRESS || '';
    return { enabled, zats, treasury };
  }
});

