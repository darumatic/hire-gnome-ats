import sanitizeHtml from 'sanitize-html';

const ALLOWED_TAGS = [
	'p', 'br', 'hr', 'div', 'span',
	'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
	'strong', 'b', 'em', 'i', 'u', 's', 'strike',
	'ul', 'ol', 'li',
	'blockquote', 'pre', 'code',
	'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
	'a'
];

const ALLOWED_ATTRIBUTES = {
	a: ['href', 'target', 'rel'],
	'*': ['class']
};

const ALLOWED_SCHEMES = ['http', 'https', 'mailto'];

export function sanitizeRichTextHtml(value) {
	const html = String(value ?? '').trim();
	if (!html) return null;

	const clean = sanitizeHtml(html, {
		allowedTags: ALLOWED_TAGS,
		allowedAttributes: ALLOWED_ATTRIBUTES,
		allowedSchemes: ALLOWED_SCHEMES,
		allowedSchemesByTag: { a: ALLOWED_SCHEMES },
		allowProtocolRelative: false,
		enforceHtmlBoundary: false,
		disallowedTagsMode: 'discard'
	});

	if (!hasMeaningfulRichTextContent(clean)) return null;
	return clean;
}

export function stripRichTextToPlainText(value) {
	const html = String(value ?? '')
		.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, ' ')
		.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ' ')
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, '\n')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/gi, ' ')
		// &amp; must be unescaped last — unescaping it first would re-activate
		// other entities in double-encoded input (e.g. "&amp;lt;" decoding to
		// a literal "<" instead of staying as the text "&lt;").
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/&amp;/gi, '&')
		.replace(/\s+/g, ' ')
		.trim();

	return html;
}

export function hasMeaningfulRichTextContent(value) {
	return stripRichTextToPlainText(value).length > 0;
}
