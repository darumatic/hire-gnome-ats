#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('node:fs');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');

require('./load-env.cjs');

const prisma = new PrismaClient();

const IMPORT_ROOT = path.resolve(process.cwd(), 'imports/freshteam');
const PAYLOAD_PATH = path.join(IMPORT_ROOT, 'payload/freshteam-payload.json');
const CV_ROOT = path.join(IMPORT_ROOT, 'cvs');
const LOCAL_STORAGE_ROOT = process.env.LOCAL_STORAGE_ROOT || path.join(process.cwd(), '.local-storage');
const MODE = process.argv.includes('--run') ? 'run' : 'dry-run';

const OWNER_EMAIL = 'adrian@darumatic.com';
const DIVISION_NAME = 'IT Consulting';
const CLIENT_NAME = 'Darumatic';

function cleanPathSegment(value) {
	return String(value || '')
		.trim()
		.replace(/[^a-zA-Z0-9._-]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
}

function normalizeStorageFileName(fileName) {
	const parsed = path.parse(String(fileName || '').trim());
	const base = cleanPathSegment(parsed.name) || 'file';
	const ext = String(parsed.ext || '.bin').toLowerCase().slice(0, 10);
	return `${base.slice(0, 120)}${ext}`;
}

function truncateChars(value, maxLength = 190) {
	const raw = String(value || '').trim();
	return raw.length > maxLength ? raw.slice(0, maxLength) : raw;
}

function truncateBytes(value, maxBytes = 60000) {
	const raw = String(value || '').replace(/\u0000/g, '').trim();
	if (Buffer.byteLength(raw, 'utf8') <= maxBytes) return raw;
	let output = raw;
	while (Buffer.byteLength(output, 'utf8') > maxBytes - 40) {
		output = output.slice(0, Math.max(0, output.length - 100));
	}
	return `${output}\n\n[Truncated during Freshteam migration]`;
}

function toDate(value, fallback = null) {
	if (!value) return fallback;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? fallback : date;
}

function numberOrNull(value) {
	if (typeof value === 'number' && Number.isFinite(value)) return value;
	return null;
}

function integerOrDefault(value, fallback = 1) {
	if (Number.isInteger(value)) return value;
	const parsed = Number.parseInt(String(value || ''), 10);
	return Number.isInteger(parsed) ? parsed : fallback;
}

function pruneJson(value) {
	if (Array.isArray(value)) return value.map(pruneJson);
	if (!value || typeof value !== 'object') return value;
	const output = {};
	for (const [key, item] of Object.entries(value)) {
		if (typeof item === 'undefined') continue;
		output[key] = pruneJson(item);
	}
	return output;
}

function contentTypeFor(fileName) {
	const ext = path.extname(String(fileName || '')).toLowerCase();
	if (ext === '.pdf') return 'application/pdf';
	if (ext === '.doc') return 'application/msword';
	if (ext === '.docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
	if (ext === '.html' || ext === '.htm') return 'text/html';
	if (ext === '.txt') return 'text/plain';
	return 'application/octet-stream';
}

function batchRows(rows, size = 250) {
	const batches = [];
	for (let index = 0; index < rows.length; index += size) {
		batches.push(rows.slice(index, index + size));
	}
	return batches;
}

async function createManyBatched(model, label, rows, batchSize = 250) {
	let count = 0;
	for (const batch of batchRows(rows, batchSize)) {
		const result = await model.createMany({ data: batch, skipDuplicates: true });
		count += result.count;
	}
	console.log(`${label}: ${count}`);
	return count;
}

function loadPayload() {
	const payload = JSON.parse(fs.readFileSync(PAYLOAD_PATH, 'utf8'));
	if (!Array.isArray(payload.candidates) || !Array.isArray(payload.jobs)) {
		throw new Error('Freshteam payload is missing candidates or jobs.');
	}
	return payload;
}

function dedupeSubmissions(submissions) {
	const sorted = [...submissions].sort((a, b) => {
		const left = new Date(a.createdAt || 0).getTime();
		const right = new Date(b.createdAt || 0).getTime();
		return left - right;
	});
	const byPair = new Map();
	let duplicateCount = 0;

	for (const submission of sorted) {
		const key = `${submission.candidateFreshteamId}:${submission.jobFreshteamId}`;
		const existing = byPair.get(key);
		if (!existing) {
			byPair.set(key, { ...submission });
			continue;
		}
		duplicateCount += 1;
		const duplicates = existing.customFields.freshteamDuplicateApplicants || [];
		duplicates.push({
			freshteamId: submission.freshteamId,
			stageName: submission.customFields?.freshteamStageName || null,
			statusName: submission.customFields?.freshteamStatusName || null,
			createdAt: submission.createdAt || null,
			updatedAt: submission.updatedAt || null
		});
		existing.customFields.freshteamDuplicateApplicants = duplicates;
	}

	return { submissions: [...byPair.values()], duplicateCount };
}

async function buildContext() {
	const [owner, division, existingClient] = await Promise.all([
		prisma.user.findFirst({
			where: { email: OWNER_EMAIL },
			select: { id: true, email: true }
		}),
		prisma.division.findFirst({
			where: { name: DIVISION_NAME },
			select: { id: true, name: true }
		}),
		prisma.client.findFirst({
			where: { name: CLIENT_NAME },
			select: { id: true, recordId: true, name: true }
		})
	]);

	const fallbackOwner = owner || (await prisma.user.findFirst({ select: { id: true, email: true }, orderBy: { id: 'asc' } }));
	const fallbackDivision =
		division || (await prisma.division.findFirst({ select: { id: true, name: true }, orderBy: { id: 'asc' } }));

	if (!fallbackOwner) throw new Error('No user exists for import ownership.');
	if (!fallbackDivision) throw new Error('No division exists for import ownership.');

	let client = existingClient;
	if (!client && MODE === 'run') {
		client = await prisma.client.create({
			data: {
				recordId: 'CLI-FTDARUMATIC',
				name: CLIENT_NAME,
				status: 'Active',
				owner: fallbackOwner.email,
				ownerId: fallbackOwner.id,
				divisionId: fallbackDivision.id,
				customFields: { freshteamMigrationClient: true }
			},
			select: { id: true, recordId: true, name: true }
		});
	}

	return { owner: fallbackOwner, division: fallbackDivision, client };
}

async function operationalCounts() {
	return {
		candidates: await prisma.candidate.count(),
		clients: await prisma.client.count(),
		contacts: await prisma.contact.count(),
		jobOrders: await prisma.jobOrder.count(),
		submissions: await prisma.submission.count(),
		interviews: await prisma.interview.count(),
		attachments: await prisma.candidateAttachment.count()
	};
}

async function hasSubmissionCandidateSourceColumn() {
	const rows = await prisma.$queryRawUnsafe("SHOW COLUMNS FROM Submission LIKE 'candidateSource'");
	return Array.isArray(rows) && rows.length > 0;
}

function assertNoDuplicateKeys(rows, label, keyFn) {
	const seen = new Set();
	let duplicates = 0;
	for (const row of rows) {
		const key = keyFn(row);
		if (seen.has(key)) duplicates += 1;
		seen.add(key);
	}
	if (duplicates) {
		throw new Error(`${label} has ${duplicates} duplicate keys.`);
	}
}

function validatePayload(payload, uniqueSubmissions) {
	assertNoDuplicateKeys(payload.candidates, 'Candidates', (row) => String(row.email || '').toLowerCase());
	assertNoDuplicateKeys(payload.candidates, 'Candidate record IDs', (row) => row.recordId);
	assertNoDuplicateKeys(payload.jobs, 'Job record IDs', (row) => row.recordId);
	assertNoDuplicateKeys(uniqueSubmissions, 'Submission pairs', (row) => `${row.candidateFreshteamId}:${row.jobFreshteamId}`);
	assertNoDuplicateKeys(uniqueSubmissions, 'Submission record IDs', (row) => row.recordId);

	const missingFiles = [];
	for (const attachment of payload.candidateAttachments || []) {
		const sourcePath = path.join(CV_ROOT, attachment.relativePath || '');
		if (!fs.existsSync(sourcePath)) {
			missingFiles.push(attachment.relativePath);
			if (missingFiles.length >= 10) break;
		}
	}
	if (missingFiles.length) {
		throw new Error(`Missing candidate attachment files: ${missingFiles.join(', ')}`);
	}
}

async function fetchIdMap(model, recordIds) {
	const map = new Map();
	for (const batch of batchRows(recordIds, 1000)) {
		const rows = await model.findMany({
			where: { recordId: { in: batch } },
			select: { id: true, recordId: true }
		});
		for (const row of rows) map.set(row.recordId, row.id);
	}
	return map;
}

function candidateRows(payload, context) {
	return payload.candidates.map((row) => {
		const createdAt = toDate(row.createdAt) || new Date();
		return {
			recordId: row.recordId,
			firstName: truncateChars(row.firstName),
			lastName: truncateChars(row.lastName),
			email: truncateChars(row.email?.toLowerCase(), 190),
			phone: truncateChars(row.phone),
			mobile: truncateChars(row.mobile),
			status: truncateChars(row.status || 'new'),
			source: truncateChars(row.source),
			owner: truncateChars(row.owner || context.owner.email),
			currentJobTitle: truncateChars(row.currentJobTitle),
			currentEmployer: truncateChars(row.currentEmployer),
			experienceYears: numberOrNull(row.experienceYears),
			address: truncateChars(row.address),
			city: truncateChars(row.city),
			country: truncateChars(row.country),
			website: truncateChars(row.website),
			linkedinUrl: truncateChars(row.linkedinUrl),
			skillSet: truncateBytes(row.skillSet, 60000),
			summary: truncateBytes(row.summary, 60000),
			customFields: pruneJson({ ...(row.customFields || {}), freshteamMigration: true }),
			ownerId: context.owner.id,
			divisionId: context.division.id,
			createdAt,
			updatedAt: toDate(row.updatedAt, createdAt)
		};
	});
}

function jobRows(payload, context) {
	return payload.jobs.map((row) => {
		const createdAt = toDate(row.createdAt) || new Date();
		const plainDescription = String(row.publicDescription || '').replace(/<[^>]+>/g, ' ');
		return {
			recordId: row.recordId,
			title: truncateChars(row.title),
			description: truncateChars(plainDescription, 180),
			publicDescription: truncateBytes(row.publicDescription, 60000),
			location: truncateChars(row.location),
			city: truncateChars(row.city),
			state: truncateChars(row.state),
			zipCode: truncateChars(row.zipCode, 20),
			status: truncateChars(row.status || 'open'),
			employmentType: truncateChars(row.employmentType),
			openings: integerOrDefault(row.openings, 1),
			currency: truncateChars(row.currency || 'AUD', 20),
			salaryMin: numberOrNull(row.salaryMin),
			salaryMax: numberOrNull(row.salaryMax),
			publishToCareerSite: false,
			openedAt: toDate(row.openedAt, createdAt),
			closedAt: toDate(row.closedAt),
			customFields: pruneJson({ ...(row.customFields || {}), freshteamMigration: true }),
			ownerId: context.owner.id,
			divisionId: context.division.id,
			clientId: context.client.id,
			createdAt,
			updatedAt: toDate(row.updatedAt, createdAt)
		};
	});
}

function educationRows(payload, candidateMap) {
	return payload.candidateEducations
		.map((row) => {
			const candidateId = candidateMap.get(`CAN-FT${row.candidateFreshteamId}`);
			if (!candidateId) return null;
			const createdAt = toDate(row.createdAt) || new Date();
			return {
				recordId: row.recordId,
				candidateId,
				schoolName: truncateChars(row.schoolName),
				degree: truncateChars(row.degree),
				fieldOfStudy: truncateChars(row.fieldOfStudy),
				startDate: toDate(row.startDate),
				endDate: toDate(row.endDate),
				isCurrent: Boolean(row.isCurrent),
				description: truncateBytes(row.description, 60000),
				createdAt,
				updatedAt: toDate(row.updatedAt, createdAt)
			};
		})
		.filter(Boolean);
}

function workRows(payload, candidateMap) {
	return payload.candidateWorkExperiences
		.map((row) => {
			const candidateId = candidateMap.get(`CAN-FT${row.candidateFreshteamId}`);
			if (!candidateId) return null;
			const createdAt = toDate(row.createdAt) || new Date();
			return {
				recordId: row.recordId,
				candidateId,
				companyName: truncateChars(row.companyName),
				title: truncateChars(row.title),
				location: truncateChars(row.location),
				startDate: toDate(row.startDate),
				endDate: toDate(row.endDate),
				isCurrent: Boolean(row.isCurrent),
				description: truncateBytes(row.description, 60000),
				createdAt,
				updatedAt: toDate(row.updatedAt, createdAt)
			};
		})
		.filter(Boolean);
}

function noteRows(payload, candidateMap) {
	return payload.candidateNotes
		.map((row) => {
			const candidateId = candidateMap.get(`CAN-FT${row.candidateFreshteamId}`);
			if (!candidateId) return null;
			const createdAt = toDate(row.createdAt) || new Date();
			return {
				recordId: row.recordId,
				candidateId,
				noteType: 'freshteam',
				content: truncateBytes(row.content, 60000),
				createdAt,
				updatedAt: toDate(row.updatedAt, createdAt)
			};
		})
		.filter(Boolean);
}

function submissionRows(submissions, candidateMap, jobMap) {
	return submissions
		.map((row) => {
			const candidateId = candidateMap.get(`CAN-FT${row.candidateFreshteamId}`);
			const jobOrderId = jobMap.get(`JOB-FT${row.jobFreshteamId}`);
			if (!candidateId || !jobOrderId) return null;
			const createdAt = toDate(row.createdAt) || new Date();
			return {
				recordId: row.recordId,
				candidateId,
				jobOrderId,
				status: truncateChars(row.status || 'submitted'),
				notes: truncateBytes(row.notes, 60000),
				customFields: pruneJson({ ...(row.customFields || {}), freshteamMigration: true }),
				createdAt,
				updatedAt: toDate(row.updatedAt, createdAt)
			};
		})
		.filter(Boolean);
}

function interviewRows(payload, candidateMap, jobMap) {
	return payload.interviews
		.map((row) => {
			const candidateId = candidateMap.get(`CAN-FT${row.candidateFreshteamId}`);
			const jobOrderId = jobMap.get(`JOB-FT${row.jobFreshteamId}`);
			if (!candidateId || !jobOrderId) return null;
			const createdAt = toDate(row.createdAt) || new Date();
			return {
				recordId: row.recordId,
				candidateId,
				jobOrderId,
				subject: truncateChars(row.subject),
				status: truncateChars(row.status || 'scheduled'),
				startsAt: toDate(row.startsAt),
				endsAt: toDate(row.endsAt),
				location: truncateChars(row.location),
				feedback: truncateBytes(row.feedback, 60000),
				customFields: pruneJson({ ...(row.customFields || {}), freshteamMigration: true }),
				createdAt,
				updatedAt: toDate(row.updatedAt, createdAt)
			};
		})
		.filter(Boolean);
}

async function attachmentRows(payload, candidateMap) {
	const rows = [];
	let copied = 0;
	let skipped = 0;
	for (const row of payload.candidateAttachments || []) {
		const candidateId = candidateMap.get(`CAN-FT${row.candidateFreshteamId}`);
		if (!candidateId) {
			skipped += 1;
			continue;
		}
		const sourcePath = path.join(CV_ROOT, row.relativePath || '');
		if (!fs.existsSync(sourcePath)) {
			skipped += 1;
			continue;
		}
		const safeFileName = normalizeStorageFileName(row.fileName);
		const storageKey = `candidates/${candidateId}/freshteam-${cleanPathSegment(row.freshteamId)}/${safeFileName}`;
		const targetPath = path.join(LOCAL_STORAGE_ROOT, storageKey);
		if (MODE === 'run') {
			fs.mkdirSync(path.dirname(targetPath), { recursive: true });
			fs.copyFileSync(sourcePath, targetPath);
		}
		const stat = fs.statSync(sourcePath);
		const createdAt = toDate(row.createdAt) || new Date();
		rows.push({
			recordId: row.recordId,
			fileName: truncateChars(row.fileName),
			isResume: Boolean(row.isResume),
			contentType: contentTypeFor(row.fileName),
			sizeBytes: stat.size,
			storageProvider: 'local',
			storageBucket: 'local',
			storageKey,
			candidateId,
			createdAt,
			updatedAt: toDate(row.updatedAt, createdAt)
		});
		copied += 1;
	}
	return { rows, copied, skipped };
}

async function backfillCandidateSourceIfColumnExists(submissions, hasColumn) {
	if (!hasColumn) return 0;
	let count = 0;
	for (const row of submissions) {
		const source = row.customFields?.candidateSource || null;
		if (!source) continue;
		await prisma.$executeRawUnsafe('UPDATE Submission SET candidateSource = ? WHERE recordId = ?', source, row.recordId);
		count += 1;
	}
	return count;
}

async function main() {
	const payload = loadPayload();
	const { submissions: uniqueSubmissions, duplicateCount } = dedupeSubmissions(payload.submissions || []);
	validatePayload(payload, uniqueSubmissions);

	const context = await buildContext();
	if (!context.client && MODE === 'dry-run') {
		context.client = { id: '(would create)', name: CLIENT_NAME, recordId: 'CLI-FTDARUMATIC' };
	}
	if (!context.client) throw new Error(`Client ${CLIENT_NAME} could not be created.`);

	const countsBefore = await operationalCounts();
	const hasCandidateSourceColumn = await hasSubmissionCandidateSourceColumn();
	const result = {
		mode: MODE,
		startedAt: new Date().toISOString(),
		context,
		countsBefore,
		payloadCounts: payload.counts,
		uniqueSubmissions: uniqueSubmissions.length,
		duplicateSubmissionPairsSkipped: duplicateCount,
		hasCandidateSourceColumn,
		imported: {}
	};

	console.log(JSON.stringify(result, null, 2));
	if (MODE !== 'run') {
		console.log('Dry run complete. Re-run with --run to import.');
		return;
	}

	await createManyBatched(prisma.candidate, 'Candidates', candidateRows(payload, context), 250);
	const candidateMap = await fetchIdMap(prisma.candidate, payload.candidates.map((row) => row.recordId));

	await createManyBatched(prisma.jobOrder, 'Job orders', jobRows(payload, context), 100);
	const jobMap = await fetchIdMap(prisma.jobOrder, payload.jobs.map((row) => row.recordId));

	result.imported.candidateEducations = await createManyBatched(
		prisma.candidateEducation,
		'Candidate education',
		educationRows(payload, candidateMap),
		250
	);
	result.imported.candidateWorkExperiences = await createManyBatched(
		prisma.candidateWorkExperience,
		'Candidate work history',
		workRows(payload, candidateMap),
		250
	);
	result.imported.candidateNotes = await createManyBatched(
		prisma.candidateNote,
		'Candidate notes',
		noteRows(payload, candidateMap),
		100
	);

	const submissionCreateRows = submissionRows(uniqueSubmissions, candidateMap, jobMap);
	result.imported.submissions = await createManyBatched(prisma.submission, 'Submissions', submissionCreateRows, 250);
	result.imported.candidateSourceBackfilled = await backfillCandidateSourceIfColumnExists(
		submissionCreateRows,
		hasCandidateSourceColumn
	);

	result.imported.interviews = await createManyBatched(
		prisma.interview,
		'Interviews',
		interviewRows(payload, candidateMap, jobMap),
		250
	);

	const attachmentBuild = await attachmentRows(payload, candidateMap);
	result.imported.attachmentFilesCopied = attachmentBuild.copied;
	result.imported.attachmentFilesSkipped = attachmentBuild.skipped;
	result.imported.candidateAttachments = await createManyBatched(
		prisma.candidateAttachment,
		'Candidate attachments',
		attachmentBuild.rows,
		250
	);

	result.countsAfter = await operationalCounts();
	result.finishedAt = new Date().toISOString();
	const resultPath = path.join(IMPORT_ROOT, `import-result-${new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, 'Z')}.json`);
	fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
	console.log(`Import result written to: ${resultPath}`);
	console.log(JSON.stringify(result.countsAfter, null, 2));
}

main()
	.catch((error) => {
		console.error(error && error.stack ? error.stack : error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
