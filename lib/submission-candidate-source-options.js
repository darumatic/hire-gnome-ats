export const SUBMISSION_CANDIDATE_SOURCE_OPTIONS = Object.freeze([
	{ value: 'Direct', label: 'Direct' },
	{ value: 'LinkedIn', label: 'LinkedIn' },
	{ value: 'Internal', label: 'Internal' },
	{ value: 'Seek', label: 'Seek' }
]);

export const SUBMISSION_CANDIDATE_SOURCE_VALUES = Object.freeze(
	SUBMISSION_CANDIDATE_SOURCE_OPTIONS.map((option) => option.value)
);

const sourceValueSet = new Set(SUBMISSION_CANDIDATE_SOURCE_VALUES);

export function normalizeSubmissionCandidateSourceValue(value) {
	const source = typeof value === 'string' ? value.trim() : '';
	if (!source) return '';
	return sourceValueSet.has(source) ? source : '';
}
