// Byte-buffer type tags (proven from BO2 Xbox 360 assembly)
export const TAG = {
  BOOL: 0x01,
  U8: 0x03,
  I16: 0x06,
  I32: 0x07,
  U32: 0x08,
  I64: 0x09,
  U64: 0x0a,
  FLOAT: 0x0d,
  STRING: 0x10,
  BLOB: 0x13,
  NULL: 0x00,
  ARRAY: 0x6e,
  U32_ARRAY: 0x6c,
} as const;

// Error codes
export const BD_NO_ERROR = 0;
export const BD_NO_FILE = 1000;

// Service type IDs
export const SERVICE_TYPES: Record<number, string> = {
  3: 'bdTeams',
  4: 'bdStats',
  6: 'bdMessaging',
  7: 'bdLobbyService',
  8: 'bdProfile',
  10: 'bdStorage',
  12: 'bdTitleUtilities',
  15: 'bdKeyArchive',
  21: 'bdMatchmaking',
  23: 'bdCounter',
  27: 'bdDml',
  28: 'bdGroup',
  31: 'bdTwitch',
  32: 'bdUnknown_32',
  33: 'bdYoutube',
  35: 'bdTwitter',
  36: 'bdFacebook',
  38: 'bdAntiCheat',
  50: 'bdContentStreaming',
  52: 'bdTags',
  55: 'bdVoteRank',
  58: 'bdPooledStorage',
  66: 'bdSubscription',
  67: 'bdEventLog',
  68: 'bdRichPresence',
  81: 'bdLeague',
  82: 'bdLeague2',
};

// Connection stages
export const STAGE_CONNECTED = 0;
export const STAGE_AUTHENTICATED = 1;

// Limits
export const MAX_CONNECTIONS_PER_IP = 5;
export const MAX_SERVICE_CALLS_PER_SEC = 100;
export const MAX_FRAME_SIZE = 65536;

// Keepalive: [len=10 LE][pdtype=0][msgType=0xFF][8 null bytes]
export const KEEPALIVE_FRAME = Buffer.from([
  0x0a, 0x00, 0x00, 0x00, 0x00, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);
export const KEEPALIVE_INTERVAL_MS = 15000;

// Static XNKEY from XEX header
export const STATIC_XNKEY = Buffer.from('8148B7BF094938A56E9019EE5CE62C28', 'hex');

// BO2 title ID
export const TITLE_ID = 0x415608c3;
