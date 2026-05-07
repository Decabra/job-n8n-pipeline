// Must reference Telegram Trigger by name since Config sits between trigger and this node
const u = $('Telegram Trigger').item.json;

if (u.callback_query && u.callback_query.data) {
  const data = String(u.callback_query.data);
  const [action, application_id] = data.split(':');
  return {
    json: {
      kind: 'callback',
      action,
      application_id,
      callback_query_id: u.callback_query.id,
      message_chat_id: u.callback_query.message?.chat?.id,
      from_id: u.callback_query.from?.id,
    },
  };
}

const text = u.message?.text || '';
if (text.startsWith('/fix')) {
  const rest = text.replace(/^\/fix\s+/i, '').trim();
  const m = rest.match(/^(\S+)\s+([\s\S]+)$/);
  if (!m) {
    return { json: { kind: 'fix_error', error: 'Usage: /fix APP-12345 your instruction' } };
  }
  return {
    json: {
      kind: 'fix',
      application_id: m[1],
      correction_instruction: m[2].trim(),
      message_chat_id: u.message?.chat?.id,
    },
  };
}

return { json: { kind: 'ignored' } };
