import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { getEntityScope } from '../../lib/access-control.js';
import { getCandidateJobOrderScope } from '../../lib/related-record-scope.js';

// Regression coverage for the /api/placements/commission-defaults bug.
//
// The route used to pass getCandidateJobOrderScope() — a RELATIONAL filter
// ({ AND: [{ candidate: … }, { jobOrder: … }] }) that is only valid on
// Submission/Placement-like models — into prisma.candidate.findFirst() and
// prisma.jobOrder.findFirst(). Those models have no `candidate`/`jobOrder`
// relations, so it threw PrismaClientValidationError ("Unknown argument `candidate`").
// The fix uses the FLAT getEntityScope() instead. These tests lock in both the
// scope-shape contract and the route's call site.

const director = {
	id: 5,
	role: 'DIRECTOR',
	divisionId: 2,
	division: { id: 2, accessMode: 'DIVISION' }
};

const ownerOnlyRecruiter = {
	id: 9,
	role: 'RECRUITER',
	divisionId: 3,
	division: { id: 3, accessMode: 'OWNER_ONLY' }
};

describe('commission-defaults scope (regression)', () => {
	describe('getEntityScope is flat and safe to apply to candidate/jobOrder models', () => {
		it('DIRECTOR scope is { divisionId } with no relation filters', () => {
			const scope = getEntityScope(director);
			expect(scope).toEqual({ divisionId: 2 });
			expect(scope).not.toHaveProperty('candidate');
			expect(scope).not.toHaveProperty('jobOrder');
		});

		it('OWNER_ONLY scope is { divisionId, ownerId } with no relation filters', () => {
			const scope = getEntityScope(ownerOnlyRecruiter);
			expect(scope).toEqual({ divisionId: 3, ownerId: 9 });
			expect(scope).not.toHaveProperty('candidate');
			expect(scope).not.toHaveProperty('jobOrder');
		});
	});

	describe('getCandidateJobOrderScope is relational (Submission/Placement only)', () => {
		it('nests candidate/jobOrder relation filters and must not be used on those models directly', () => {
			const scope = getCandidateJobOrderScope(director);
			expect(scope).toHaveProperty('AND');
			expect(scope.AND).toEqual([
				{ candidate: { divisionId: 2 } },
				{ jobOrder: { divisionId: 2 } }
			]);
		});
	});

	it('commission-defaults route uses the flat entity scope, not the relational one', () => {
		const src = readFileSync(
			new URL('../../app/api/placements/commission-defaults/route.js', import.meta.url),
			'utf8'
		);
		expect(src).toContain('getEntityScope');
		expect(src).not.toContain('getCandidateJobOrderScope');
	});
});
