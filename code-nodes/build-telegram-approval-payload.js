const j = $('Assemble Airtable Row').item.json;
const cfg = $('Config').first().json;

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function link(url, label) {
  const u = String(url || '').trim();
  if (!u) return `${esc(label)}: n/a`;
  return `<a href="${esc(u)}">${esc(label)}</a>`;
}

const changes = (j.key_resume_changes || [])
  .map((c) => `  • ${esc(c)}`)
  .join('\n');

const lines = [
  `<b>${esc(j.job_title)} — ${esc(j.company)}</b>`,
  `${esc(j.location)} · ${esc(j.fit_score)}/100`,
  '',
  esc(j.fit_summary || ''),
  '',
  '<b>Resume changes:</b>',
  changes || '  (none)',
  '',
  `${link(j.application_url, 'Apply')} · ${link(j.resume_link, 'Resume')}`,
];

const body = {
  chat_id: cfg.telegram_chat_id,
  text: lines.join('\n'),
  parse_mode: 'HTML',
  disable_web_page_preview: true,
  reply_markup: {
    inline_keyboard: [
      [
        { text: 'APPROVE', callback_data: `APPROVE_SUBMIT:${j.application_id}` },
        { text: 'REJECT', callback_data: `REJECT:${j.application_id}` },
        { text: 'NEEDS FIX', callback_data: `NEEDS_FIX:${j.application_id}` },
      ],
    ],
  },
};

return { json: { telegram_http_body: body } };
