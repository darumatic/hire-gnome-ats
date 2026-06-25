export const VIDEO_CALL_PROVIDER_OPTIONS = [
	{ value: 'zoom', label: 'Zoom' },
	{ value: 'teams', label: 'Microsoft Teams' },
	{ value: 'google_meet', label: 'Google Meet' },
	{ value: 'webex', label: 'Webex' },
	{ value: 'other', label: 'Other' }
];

const VIDEO_CALL_PROVIDER_LABELS = new Map(
	VIDEO_CALL_PROVIDER_OPTIONS.map((option) => [option.value, option.label])
);

const VIDEO_CALL_PROVIDER_TEMPLATES = new Map([
	['zoom', 'https://zoom.us/j/'],
	['teams', 'https://teams.microsoft.com/l/meetup-join/'],
	['google_meet', 'https://meet.google.com/'],
	['webex', 'https://'],
	['other', 'https://']
]);

export function normalizeVideoCallProvider(value) {
	const normalized = String(value || '').trim().toLowerCase();
	return VIDEO_CALL_PROVIDER_LABELS.has(normalized) ? normalized : '';
}

export function getVideoCallProviderLabel(value) {
	const normalized = normalizeVideoCallProvider(value);
	return normalized ? VIDEO_CALL_PROVIDER_LABELS.get(normalized) : 'Video';
}

export function getVideoCallProviderTemplate(value) {
	const normalized = normalizeVideoCallProvider(value);
	return normalized ? VIDEO_CALL_PROVIDER_TEMPLATES.get(normalized) || '' : '';
}

export function getVideoCallLinkPlaceholder(value) {
	const normalized = normalizeVideoCallProvider(value);
	if (normalized === 'zoom') return 'https://zoom.us/j/...';
	if (normalized === 'teams') return 'https://teams.microsoft.com/l/meetup-join/...';
	if (normalized === 'google_meet') return 'https://meet.google.com/...';
	if (normalized === 'webex') return 'https://your-company.webex.com/meet/...';
	if (normalized === 'other') return 'https://...';
	return 'https://zoom.us/j/...';
}

function hostnameMatches(hostname, domain) {
	return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function inferVideoCallProviderFromLink(value) {
	const link = String(value || '').trim();
	if (!link) return '';

	let hostname = '';
	try {
		hostname = new URL(link).hostname.toLowerCase();
	} catch {
		return 'other';
	}

	if (hostnameMatches(hostname, 'zoom.us')) return 'zoom';
	if (hostnameMatches(hostname, 'teams.microsoft.com')) return 'teams';
	if (hostnameMatches(hostname, 'meet.google.com')) return 'google_meet';
	if (hostnameMatches(hostname, 'webex.com')) return 'webex';
	return 'other';
}
