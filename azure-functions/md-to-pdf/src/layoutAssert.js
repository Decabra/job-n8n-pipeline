'use strict';

/**
 * Parse experience roles from resume markdown and assert each role's bullets
 * appear on the same PDF page as the role heading (extracted via pdfjs).
 */

function normalizeText(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function snippet(text, len = 28) {
  return normalizeText(text).slice(0, len);
}

/**
 * @param {string} markdown
 * @returns {{ label: string, marker: string, bullets: { full: string, marker: string }[] }[]}
 */
function parseExperienceRoles(markdown) {
  const src = String(markdown || '');
  const match = src.match(/## Experience\s*\n([\s\S]*?)(?=\n## |\s*$)/);
  if (!match) return [];

  const roles = [];
  for (const block of match[1].split(/\n(?=### )/)) {
    const trimmed = block.trim();
    if (!trimmed.startsWith('### ')) continue;

    const lines = trimmed.split('\n');
    const heading = lines[0].replace(/^###\s*/, '').trim();
    const bullets = lines
      .filter((l) => l.startsWith('- '))
      .map((l) => l.slice(2).trim());

    if (!bullets.length) continue;

    // Company token after first comma in heading (stable across PDF line wraps)
    const company = heading.split(',')[1]?.split('*')[0]?.trim() || heading.slice(0, 40);
    roles.push({
      label: heading.split('*')[0].trim(),
      marker: snippet(company, 20),
      bullets: bullets.map((b) => ({ full: b, marker: snippet(b, 32) })),
    });
  }
  return roles;
}

function pageIndexForMarker(pages, marker) {
  const m = normalizeText(marker);
  for (let i = 0; i < pages.length; i++) {
    if (normalizeText(pages[i]).includes(m)) return i;
  }
  return -1;
}

/**
 * @param {string[]} pages — one string per PDF page
 * @param {ReturnType<typeof parseExperienceRoles>[number]} role
 */
function assertRoleOnSinglePage(pages, role) {
  const headerPage = pageIndexForMarker(pages, role.marker);
  if (headerPage < 0) {
    throw new Error(`Role header not found in PDF: ${role.label} (marker "${role.marker}")`);
  }

  const failures = [];
  for (const bullet of role.bullets) {
    const bulletPage = pageIndexForMarker(pages, bullet.marker);
    if (bulletPage < 0) {
      failures.push(`bullet not found: "${bullet.marker}…"`);
    } else if (bulletPage !== headerPage) {
      failures.push(
        `"${bullet.marker}…" on page ${bulletPage + 1}, header on page ${headerPage + 1}`,
      );
    }
  }

  if (failures.length) {
    throw new Error(`${role.label}: ${failures.join('; ')}`);
  }

  return { role: role.label, page: headerPage + 1, bullets: role.bullets.length };
}

/**
 * @param {string} markdown
 * @param {Buffer} pdfBuffer
 */
function assertExperienceRolesIntact(markdown, pages) {
  const roles = parseExperienceRoles(markdown);
  if (!roles.length) {
    throw new Error('No experience roles found in markdown');
  }

  const results = [];
  for (const role of roles) {
    results.push(assertRoleOnSinglePage(pages, role));
  }
  return results;
}

/** @param {string} markdown */
function extractMarkdownLinkTargets(markdown) {
  const targets = [];
  const re = /\[[^\]]*\]\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(String(markdown || ''))) !== null) {
    const url = m[1].trim();
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('mailto:')) {
      targets.push(url);
    }
  }
  return targets;
}

/**
 * Chromium embeds link URIs in the PDF byte stream. Fail if markdown links are missing.
 * @param {string} markdown
 * @param {Buffer} pdfBuffer
 */
function assertPdfLinkTargets(markdown, pdfBuffer) {
  const targets = extractMarkdownLinkTargets(markdown);
  if (!targets.length) {
    throw new Error('No markdown links found in resume — check source file');
  }

  const raw = pdfBuffer.toString('latin1');
  const missing = [];
  for (const url of targets) {
    // PDF may store URI escaped or as plain substring
    const host = url.replace(/^https?:\/\//, '').split('/')[0];
    if (!raw.includes(url) && !raw.includes(host)) {
      missing.push(url);
    }
  }

  if (missing.length) {
    throw new Error(`PDF missing ${missing.length} link(s): ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}`);
  }

  return targets;
}

module.exports = {
  parseExperienceRoles,
  assertExperienceRolesIntact,
  assertPdfLinkTargets,
  extractMarkdownLinkTargets,
  normalizeText,
  snippet,
};
