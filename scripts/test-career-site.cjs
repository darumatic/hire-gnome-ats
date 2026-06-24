/* eslint-disable no-console */
require('./load-env.cjs');

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const BASE_URL = String(process.env.BASE_URL || 'http://localhost:3000').trim().replace(/\/+$/, '');
const RECORD_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomToken(length = 8) {
	let token = '';
	for (let i = 0; i < length; i++) {
		token += RECORD_ID_ALPHABET[Math.floor(Math.random() * RECORD_ID_ALPHABET.length)];
	}
	return token;
}

function createRecordId(prefix) {
	return `${prefix.toUpperCase()}-${randomToken()}`;
}

function assert(condition, message) {
	if (!condition) throw new Error(`FAIL: ${message}`);
}

function log(msg) {
	console.log(`  ✓ ${msg}`);
}

async function ensureReachable() {
	const res = await fetch(`${BASE_URL}/api/health`);
	if (!res.ok) throw new Error(`Health endpoint returned ${res.status}`);
}

async function run() {
	const suffix = `${Date.now()}`;
	const state = { clientId: null, jobOrderId: null, candidateId: null, submissionId: null };

	await ensureReachable();

	try {
		// ── Seed ──────────────────────────────────────────────────────────────────
		const client = await prisma.client.create({
			data: {
				recordId: createRecordId('CLI'),
				name: `CS Smoke Client ${suffix}`,
				status: 'Active'
			}
		});
		state.clientId = client.id;

		const xssDescription = '<p>Good role.</p><img src=x onerror="window.__xss=1"><script>window.__xss2=1</script>';
		const q1Id = `q1-${suffix}`;
		const q2Id = `q2-${suffix}`;

		const jobOrder = await prisma.jobOrder.create({
			data: {
				recordId: createRecordId('JOB'),
				title: `CS Smoke Job ${suffix}`,
				clientId: client.id,
				status: 'open',
				publishToCareerSite: true,
				publicDescription: xssDescription,
				applicationQuestions: [
					{ id: q1Id, label: 'Working rights', required: true },
					{ id: q2Id, label: 'Availability', required: false }
				]
			}
		});
		state.jobOrderId = jobOrder.id;

		// ── Test 1: Public job detail API — sensitive fields absent ───────────────
		const detailRes = await fetch(`${BASE_URL}/api/careers/jobs/${jobOrder.id}`);
		assert(detailRes.ok, `Detail API returned ${detailRes.status}`);
		const detail = await detailRes.json();

		assert(!('responseCount' in detail), 'responseCount must not be in public detail API');
		assert(!('salaryMin' in detail), 'salaryMin must not be in public detail API');
		assert(!('salaryMax' in detail), 'salaryMax must not be in public detail API');
		assert(!('recordId' in detail), 'recordId must not be in public detail API');
		assert(!('contact' in detail), 'contact (hiring manager) must not be in public detail API');
		log('Public detail API does not expose sensitive fields (LOW-1 regression)');

		// ── Test 2: publicDescription is sanitized at render time (HIGH-1 regression)
		assert(!detail.publicDescription.includes('onerror'), 'onerror attribute must be stripped from publicDescription');
		assert(!detail.publicDescription.includes('<script'), 'script tag must be stripped from publicDescription');
		assert(detail.publicDescription.includes('Good role'), 'safe text content must be preserved');
		log('publicDescription XSS payload stripped at render time (HIGH-1 regression)');

		// ── Test 3: applicationQuestions present ───────────────────────────────────
		assert(Array.isArray(detail.applicationQuestions), 'applicationQuestions must be an array');
		assert(detail.applicationQuestions.length === 2, 'both questions must be present');
		log('applicationQuestions returned in public detail API');

		// ── Test 4: Apply with answers ────────────────────────────────────────────
		const minimalPdf = Buffer.from('%PDF-1.4 1 0 obj<</Type/Catalog>>endobj');
		const form = new FormData();
		form.set('firstName', 'Smoke');
		form.set('lastName', 'Tester');
		form.set('email', `smoke.${suffix}@cs-test.local`);
		form.set('mobile', '0400000001');
		form.set('zipCode', '2000');
		form.set('linkedinUrl', '');
		form.set('faxNumber', '');
		form.set('startedAtMs', String(Date.now() - 30_000));
		form.set('applicationAnswers', JSON.stringify([
			{ questionId: q1Id, answer: 'Australian citizen' },
			{ questionId: q2Id, answer: 'Immediately available' }
		]));
		form.set('resumeFile', new Blob([minimalPdf], { type: 'application/pdf' }), 'smoke-resume.pdf');

		const applyRes = await fetch(`${BASE_URL}/api/careers/jobs/${jobOrder.id}/apply`, {
			method: 'POST',
			body: form
		});
		assert(applyRes.status === 201, `Apply must return 201, got ${applyRes.status}`);
		const applyBody = await applyRes.json();
		assert(applyBody.ok, 'Apply response must have ok:true');
		assert(applyBody.submissionId, 'Apply response must include submissionId');
		state.submissionId = applyBody.submissionId;
		state.candidateId = applyBody.candidateId;
		log(`Application submitted successfully (submissionId=${state.submissionId})`);

		// ── Test 5: Answers stored on Submission.customFields (commit 0391c8e regression)
		const submission = await prisma.submission.findUnique({
			where: { id: state.submissionId }
		});
		assert(submission, 'Submission row must exist in DB');
		const cf = submission.customFields;
		assert(cf && Array.isArray(cf.applicationAnswers), 'customFields.applicationAnswers must be an array');
		assert(cf.applicationAnswers.length === 2, 'both answers must be stored');
		const labels = cf.applicationAnswers.map((a) => a.question);
		assert(labels.includes('Working rights'), 'Working rights answer must be stored');
		assert(labels.includes('Availability'), 'Availability answer must be stored');
		log('Application answers stored on Submission.customFields (answer-storage regression)');

		// ── Test 6: Bot protection — honeypot blocks silently ─────────────────────
		const countBefore = await prisma.submission.count({ where: { jobOrderId: jobOrder.id } });
		const botForm = new FormData();
		botForm.set('firstName', 'Bot');
		botForm.set('lastName', 'Test');
		botForm.set('email', `bot.${suffix}@cs-test.local`);
		botForm.set('mobile', '0400000002');
		botForm.set('zipCode', '2000');
		botForm.set('startedAtMs', String(Date.now() - 30_000));
		botForm.set('faxNumber', 'honeypot-triggered');
		botForm.set('resumeFile', new Blob([minimalPdf], { type: 'application/pdf' }), 'bot.pdf');
		const botRes = await fetch(`${BASE_URL}/api/careers/jobs/${jobOrder.id}/apply`, { method: 'POST', body: botForm });
		assert(botRes.ok, `Honeypot request must return 200 (silent pass), got ${botRes.status}`);
		const countAfter = await prisma.submission.count({ where: { jobOrderId: jobOrder.id } });
		assert(countAfter === countBefore, 'Honeypot must not create a new submission');
		log('Honeypot silently blocked bot submission');

		console.log('\nCareer site smoke checks passed.');
		console.log(`Verified against ${BASE_URL}`);
	} finally {
		// ── Cleanup ───────────────────────────────────────────────────────────────
		if (state.submissionId) {
			await prisma.submission.deleteMany({ where: { id: state.submissionId } });
		}
		if (state.candidateId) {
			await prisma.candidateNote.deleteMany({ where: { candidateId: state.candidateId } });
			await prisma.candidateAttachment.deleteMany({ where: { candidateId: state.candidateId } });
			await prisma.candidate.deleteMany({ where: { id: state.candidateId } });
		}
		if (state.jobOrderId) {
			await prisma.jobOrder.deleteMany({ where: { id: state.jobOrderId } });
		}
		if (state.clientId) {
			await prisma.client.deleteMany({ where: { id: state.clientId } });
		}
		await prisma.$disconnect();
	}
}

run().catch(async (error) => {
	console.error('\nCareer site smoke checks failed.');
	console.error(error?.message || error);
	await prisma.$disconnect();
	process.exit(1);
});
