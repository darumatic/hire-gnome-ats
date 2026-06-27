import { describe, it, expect } from 'vitest';
import { parsePositiveInt, parseRouteId, ValidationError } from '../../lib/request-validation.js';

describe('parsePositiveInt', () => {
	describe('valid inputs', () => {
		it('accepts a normal positive integer string', () => {
			expect(parsePositiveInt('1')).toBe(1);
		});

		it('accepts a large but safe integer', () => {
			expect(parsePositiveInt('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER);
		});

		it('accepts numeric value passed as number', () => {
			expect(parsePositiveInt(42)).toBe(42);
		});
	});

	describe('invalid inputs throw ValidationError', () => {
		it('rejects zero', () => {
			expect(() => parsePositiveInt('0')).toThrow(ValidationError);
		});

		it('rejects negative integer', () => {
			expect(() => parsePositiveInt('-1')).toThrow(ValidationError);
		});

		it('rejects float', () => {
			expect(() => parsePositiveInt('1.5')).toThrow(ValidationError);
		});

		it('rejects alphabetic string', () => {
			expect(() => parsePositiveInt('abc')).toThrow(ValidationError);
		});

		it('rejects "me" (LOW-7 regression)', () => {
			expect(() => parsePositiveInt('me')).toThrow(ValidationError);
		});

		it('rejects empty string', () => {
			expect(() => parsePositiveInt('')).toThrow(ValidationError);
		});

		it('rejects null', () => {
			expect(() => parsePositiveInt(null)).toThrow(ValidationError);
		});

		it('rejects undefined', () => {
			expect(() => parsePositiveInt(undefined)).toThrow(ValidationError);
		});

		it('rejects oversized integer above MAX_SAFE_INTEGER (LOW-2 regression)', () => {
			expect(() => parsePositiveInt('999999999999999999999')).toThrow(ValidationError);
		});

		it('rejects Infinity', () => {
			expect(() => parsePositiveInt('Infinity')).toThrow(ValidationError);
		});

		it('rejects scientific notation that exceeds MAX_SAFE_INTEGER', () => {
			expect(() => parsePositiveInt('1e100')).toThrow(ValidationError);
		});
	});

	describe('error messages', () => {
		it('includes the field name in the error message', () => {
			try {
				parsePositiveInt('bad', 'userId');
			} catch (err) {
				expect(err.message).toContain('userId');
			}
		});

		it('throws a ValidationError with status 400', () => {
			try {
				parsePositiveInt('bad');
			} catch (err) {
				expect(err).toBeInstanceOf(ValidationError);
				expect(err.status).toBe(400);
			}
		});
	});
});

describe('parseRouteId', () => {
	it('extracts and parses id from params object', () => {
		expect(parseRouteId({ id: '5' })).toBe(5);
	});

	it('throws for non-numeric id param', () => {
		expect(() => parseRouteId({ id: 'me' })).toThrow(ValidationError);
	});

	it('throws for null params', () => {
		expect(() => parseRouteId(null)).toThrow(ValidationError);
	});

	it('supports custom field name', () => {
		expect(parseRouteId({ jobId: '99' }, 'jobId')).toBe(99);
	});
});
