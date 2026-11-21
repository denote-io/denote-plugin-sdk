import { compare, valid } from "semver";
// src/contracts.ts
var PLUGIN_MANIFEST_SCHEMA_VERSION = 1;
var PLUGIN_API_VERSION = 1;
var PLUGIN_CATEGORIES = [
	"code",
	"productivity",
	"knowledge-management",
	"editor-writing",
	"diagrams-visualization",
	"collaboration",
	"accessibility",
	"security-privacy",
	"other"
];
var PLUGIN_CAPABILITIES = [
	"commands",
	"sidebar",
	"status",
	"editor-decoration",
	"emoji-picker",
	"structured-viewer",
	"kanban-board",
	"task-list",
	"text-styling",
	"note-comments",
	"presentation",
	"speech",
	"credential-store",
	"note-graph",
	"calendar",
	"reminders",
	"time-tracking",
	"clocks",
	"diagram-renderer",
	"note-events",
	"project-context",
	"code-intelligence",
	"tooling",
	"terminal",
	"source-control",
	"automatic-local-commit",
	"automatic-git-push",
	"git",
	"workspace-read",
	"workspace-write",
	"network",
	"clipboard-read",
	"clipboard-write",
	"notifications",
	"process",
	"secure-storage"
];
var PLUGIN_GUIDE_SECTIONS = [
	"purpose",
	"enablement and permissions",
	"usage",
	"settings",
	"disable behavior",
	"troubleshooting"
];
var PLUGIN_SOURCE_CONTROL_MAX_FILE_STATS = 5e3;
// src/timeTracking.ts
var MAX_TIME_TRACKING_SESSIONS = 500;
var MAX_TIME_TRACKING_HISTORY = 32;
var MAX_TIME_TRACKING_SEGMENTS = 512;
var TIME_TRACKING_STOP_KEY = "host.time-tracking-stop.v1";
function timeTrackingSessionElapsed(session, from, to) {
	return session.segments.reduce((total, segment) => total + Math.max(0, Math.min(to, segment.startedAt + segment.elapsedMs) - Math.max(from, segment.startedAt)), 0);
}
function timeTrackingTotals(sessions, from, to, group) {
	const totals = /* @__PURE__ */ new Map();
	for (const session of sessions) {
		const elapsed = timeTrackingSessionElapsed(session, from, to);
		if (elapsed === 0) continue;
		const groups = group === "note" ? [{
			id: session.path,
			label: session.path
		}] : group === "project" ? [{
			id: session.project?.projectId ?? "",
			label: session.project ? session.project.rootPath || "Vault root" : "No project"
		}] : (session.tags.length ? session.tags : [""]).map((tag) => ({
			id: tag,
			label: tag || "No tags"
		}));
		for (const { id, label } of groups) {
			const previous = totals.get(id);
			totals.set(id, {
				id,
				label,
				elapsedMs: (previous?.elapsedMs ?? 0) + elapsed
			});
		}
	}
	return [...totals.values()].sort((a, b) => b.elapsedMs - a.elapsedMs || a.label.localeCompare(b.label));
}
function exportTimeTrackingSessions(sessions, format, exportedAt) {
	if (!timestamp$1(exportedAt) || format !== "csv" && format !== "json" || !isPluginTimeTrackingModel({
		sessions,
		activeSessionId: sessions.find((session) => session.status !== "stopped")?.id ?? null,
		activeElsewhere: false,
		notices: []
	})) throw new Error("Invalid time-tracking export.");
	if (format === "json") return JSON.stringify({
		schemaVersion: 1,
		exportedAt: new Date(exportedAt).toISOString(),
		sessions
	}, null, 2);
	const rows = [[
		"session_id",
		"note_path",
		"project_id",
		"project_root",
		"tags_json",
		"started_at",
		"ended_at",
		"elapsed_ms",
		"status",
		"description",
		"revision",
		"segments_json",
		"history_json",
		"recovery_notice"
	]];
	for (const session of sessions) rows.push([
		session.id,
		session.path,
		session.project?.projectId ?? "",
		session.project?.rootPath ?? "",
		JSON.stringify(session.tags),
		new Date(session.startedAt).toISOString(),
		session.endedAt === null ? "" : new Date(session.endedAt).toISOString(),
		session.elapsedMs,
		session.status,
		session.description,
		session.revision,
		JSON.stringify(session.segments),
		JSON.stringify(session.history),
		session.recoveryNotice ?? ""
	]);
	return rows.map((row) => row.map((value) => {
		let cell = String(value);
		if (/^\s*[=+@-]|^[\t\r\n]/u.test(cell)) cell = `'${cell}`;
		return `"${cell.replace(/"/gu, "\"\"")}"`;
	}).join(",")).join("\r\n") + "\r\n";
}
var SAFE_TEXT$5 = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]*$/u;
function isPluginTimeTrackingClock(value) {
	return record$4(value) && text$3(value.bootId, 128, true) && timestamp$1(value.wallTimeMs) && integer$3(value.monotonicMs);
}
function isPluginTimeTrackingRegistration(value) {
	return record$4(value) && text$3(value.id, 160, true) && text$3(value.title, 160, true);
}
function isPluginTimeTrackingTarget(value) {
	return record$4(value) && path(value.path) && tags(value.tags) && project(value.project);
}
function isPluginTimeTrackingRequest(value) {
	if (!record$4(value) || !isPluginTimeTrackingClock(value.clock) || value.workspaceId !== null && !text$3(value.workspaceId, 160, true)) return false;
	if (value.mutation === void 0) return true;
	if (value.workspaceId === null) return false;
	const mutation = value.mutation;
	if (!record$4(mutation) || !text$3(mutation.id, 160, true)) return false;
	switch (mutation.type) {
		case "start": return isPluginTimeTrackingTarget(mutation.target) && text$3(mutation.description, 2e3);
		case "pause":
		case "resume":
		case "stop": return true;
		case "correct": {
			const values = mutation.values;
			return integer$3(mutation.expectedRevision) && text$3(mutation.reason, 1e3, true) && record$4(values) && timestamp$1(values.startedAt) && timestamp$1(values.endedAt) && integer$3(values.elapsedMs) && values.endedAt >= values.startedAt && values.elapsedMs <= values.endedAt - values.startedAt && text$3(values.description, 2e3) && tags(values.tags);
		}
		default: return false;
	}
}
function isPluginTimeTrackingSession(value) {
	if (!record$4(value) || !values(value) || !text$3(value.id, 160, true) || !path(value.path) || !project(value.project) || ![
		"running",
		"paused",
		"stopped"
	].includes(String(value.status)) || value.status === "stopped" !== (value.endedAt !== null) || !integer$3(value.revision) || !Array.isArray(value.history) || value.history.length > 32 || value.revision !== value.history.length || value.recoveryNotice !== null && !text$3(value.recoveryNotice, 1e3, true)) return false;
	return value.history.every((entry) => record$4(entry) && timestamp$1(entry.at) && text$3(entry.reason, 1e3, true) && values(entry.before) && values(entry.after));
}
function isPluginTimeTrackingModel(value) {
	if (!record$4(value) || !Array.isArray(value.sessions) || value.sessions.length > 500 || typeof value.activeElsewhere !== "boolean" || !Array.isArray(value.notices) || value.notices.length > 16 || !value.notices.every((notice) => text$3(notice, 1e3, true))) return false;
	const ids = /* @__PURE__ */ new Set();
	let active = null;
	for (const session of value.sessions) {
		if (!isPluginTimeTrackingSession(session) || ids.has(session.id)) return false;
		ids.add(session.id);
		if (session.status !== "stopped") {
			if (active !== null) return false;
			active = session.id;
		}
	}
	if (value.activeSessionId !== active || active !== null && value.activeElsewhere) return false;
	try {
		return new TextEncoder().encode(JSON.stringify(value)).byteLength <= 524288;
	} catch (error) {
		if (error instanceof TypeError || error instanceof RangeError) return false;
		throw error;
	}
}
function values(value) {
	if (!record$4(value) || !timestamp$1(value.startedAt) || value.endedAt !== null && !timestamp$1(value.endedAt) || !integer$3(value.elapsedMs) || !text$3(value.description, 2e3) || !tags(value.tags) || !Array.isArray(value.segments) || value.segments.length === 0 || value.segments.length > 512) return false;
	let total = 0;
	for (const segment of value.segments) {
		if (!record$4(segment) || !timestamp$1(segment.startedAt) || !integer$3(segment.elapsedMs) || !timestamp$1(segment.startedAt + segment.elapsedMs)) return false;
		total += segment.elapsedMs;
	}
	return Number.isSafeInteger(total) && total === value.elapsedMs;
}
function record$4(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function integer$3(value) {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function timestamp$1(value) {
	return integer$3(value) && value <= 0xe677d21fdbff;
}
function text$3(value, maximum, required = false) {
	return typeof value === "string" && value.length <= maximum && SAFE_TEXT$5.test(value) && (!required || value.trim().length > 0);
}
function tags(value) {
	return Array.isArray(value) && value.length <= 64 && value.every((tag) => text$3(tag, 128, true) && !/[\r\n]/u.test(tag)) && new Set(value).size === value.length;
}
function path(value, allowRoot = false) {
	return text$3(value, 2048, !allowRoot) && !/[\r\n\\:]/u.test(value) && !value.startsWith("/") && !value.endsWith("/") && (allowRoot && value === "" || value.split("/").every((part) => part !== "" && part !== "." && part !== ".." && part.toLowerCase() !== ".denote"));
}
function project(value) {
	return value === null || record$4(value) && text$3(value.projectId, 160, true) && path(value.rootPath, true);
}
// src/reminders.ts
var MAX_PLUGIN_REMINDER_DOCUMENT_BYTES = 262144;
var MAX_PLUGIN_REMINDER_TARGETS = 512;
var MAX_PLUGIN_REMINDERS = 128;
var MAX_PLUGIN_REMINDER_TITLE_BYTES = 512;
var MAX_PLUGIN_REMINDER_NOTIFICATION_TITLE_BYTES = 120;
var MAX_PLUGIN_REMINDER_NOTIFICATION_BODY_BYTES = 1024;
var MAX_PLUGIN_REMINDER_ERROR_BYTES = 2048;
var MAX_PLUGIN_REMINDER_DELIVERY_ATTEMPTS = 1e4;
var MAX_PLUGIN_REMINDER_RECURRENCE_INTERVAL = 999;
var SAFE_TEXT$4 = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]*$/u;
var REMINDER_LOCAL_DATE_TIME = /^(?!0000)(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/u;
function isPluginReminderRegistration(value) {
	return isRecord$7(value) && safeSingleLine$3(value.id, 160) && safeSingleLine$3(value.title, 160) && positiveInteger$3(value.defaultSnoozeMinutes) && value.defaultSnoozeMinutes <= 1440;
}
function isPluginReminderTargetsRequest(value) {
	return isRecord$7(value) && (value.document === null || isRecord$7(value.document) && safePath$3(value.document.path) && safeSingleLine$3(value.document.title, 200) && typeof value.document.source === "string" && stringBytes$4(value.document.source) <= 262144);
}
function isPluginReminderTargetsModel(value) {
	if (!isRecord$7(value) || !Array.isArray(value.targets) || value.targets.length === 0 || value.targets.length > 512 || typeof value.truncated !== "boolean" || !isNotices(value.notices)) return false;
	const ids = /* @__PURE__ */ new Set();
	return value.targets.every((target) => {
		if (!isPluginReminderTarget(target) || ids.has(target.id)) return false;
		ids.add(target.id);
		return true;
	});
}
function isPluginReminderQuery(value) {
	return isRecord$7(value) && isWorkspaceId(value.workspaceId) && isTimestamp(value.now);
}
function isPluginReminderMutationRequest(value) {
	return isRecord$7(value) && isWorkspaceId(value.workspaceId) && isTimestamp(value.now) && isPluginReminderMutation(value.mutation);
}
function isPluginReminderModel(value) {
	if (!isRecord$7(value) || !Array.isArray(value.reminders) || value.reminders.length > 128 || typeof value.truncated !== "boolean" || !isNotices(value.notices)) return false;
	const ids = /* @__PURE__ */ new Set();
	return value.reminders.every((reminder) => {
		if (!isPluginReminderRecord(reminder) || ids.has(reminder.id)) return false;
		ids.add(reminder.id);
		return true;
	});
}
function isReminderLocalDateTime(value) {
	if (typeof value !== "string") return false;
	const match = REMINDER_LOCAL_DATE_TIME.exec(value);
	if (!match) return false;
	const [, year, month, day, hour, minute] = match;
	const timestamp = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
	if (!Number.isFinite(timestamp)) return false;
	const date = new Date(timestamp);
	return date.getUTCFullYear() === Number(year) && date.getUTCMonth() + 1 === Number(month) && date.getUTCDate() === Number(day) && date.getUTCHours() === Number(hour) && date.getUTCMinutes() === Number(minute);
}
function isReminderTimeZone(value) {
	if (typeof value !== "string" || value.length === 0 || value.length > 80) return false;
	try {
		new Intl.DateTimeFormat("en", { timeZone: value });
		return true;
	} catch (error) {
		if (error instanceof RangeError) return false;
		throw error;
	}
}
function truncateUtf8(value, maxBytes) {
	if (maxBytes <= 0) return "";
	const encoder = new TextEncoder();
	if (encoder.encode(value).byteLength <= maxBytes) return value;
	let result = "";
	for (const character of value) {
		const next = result + character;
		if (encoder.encode(next).byteLength > maxBytes) break;
		result = next;
	}
	return result;
}
function isPluginReminderMutation(value) {
	if (!isRecord$7(value) || !safeId$1(value.id)) return false;
	switch (value.type) {
		case "create": return safeDisplayText$4(value.title, 512) && isPluginReminderTarget(value.target) && isPluginReminderSchedule(value.schedule) && isNullableRecurrence(value.recurrence) && isTimestamp(value.createdAt);
		case "update": return safeDisplayText$4(value.title, 512) && isPluginReminderTarget(value.target) && isPluginReminderSchedule(value.schedule) && isNullableRecurrence(value.recurrence) && isTimestamp(value.updatedAt);
		case "snooze": return isTimestamp(value.dueAt) && isReminderTimeZone(value.timeZone) && isTimestamp(value.updatedAt);
		case "dismiss": return isTimestamp(value.dismissedAt);
		case "complete": return safeId$1(value.historyId) && value.historyId !== value.id && isTimestamp(value.completedAt);
		case "restore": return isTimestamp(value.restoredAt);
		case "advance": return isTimestamp(value.advancedAt);
		case "remove": return isTimestamp(value.updatedAt);
		case "delivery-started": return isTimestamp(value.startedAt);
		case "delivery-succeeded": return isTimestamp(value.completedAt);
		case "delivery-failed": return isTimestamp(value.failedAt) && safeDisplayText$4(value.error, 2048);
		default: return false;
	}
}
function isPluginReminderRecord(value) {
	if (!isRecord$7(value) || !safeId$1(value.id) || !safeDisplayText$4(value.title, 512) || !isPluginReminderLink(value.target) || !isPluginReminderSchedule(value.schedule) || !isNullableRecurrence(value.recurrence) || !isTimestamp(value.dueAt) || !isNullableTimestamp(value.snoozedUntil) || value.snoozeTimeZone !== null && !isReminderTimeZone(value.snoozeTimeZone) || value.snoozedUntil === null !== (value.snoozeTimeZone === null) || ![
		"scheduled",
		"delivering",
		"notified",
		"failed",
		"completed",
		"dismissed"
	].includes(String(value.status)) || !isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt) || !nonNegativeInteger$3(value.attemptCount) || value.attemptCount > 1e4 || !isNullableTimestamp(value.deliveringAt) || !isNullableTimestamp(value.notifiedAt) || !isNullableTimestamp(value.completedAt) || !isNullableTimestamp(value.dismissedAt) || value.lastError !== null && !safeDisplayText$4(value.lastError, 2048)) return false;
	switch (value.status) {
		case "scheduled": return value.deliveringAt === null && value.notifiedAt === null && value.completedAt === null && value.dismissedAt === null && value.lastError === null;
		case "delivering": return value.deliveringAt !== null && value.notifiedAt === null && value.completedAt === null && value.dismissedAt === null && value.lastError === null;
		case "notified": return value.deliveringAt === null && value.notifiedAt !== null && value.completedAt === null && value.dismissedAt === null && value.lastError === null;
		case "failed": return value.deliveringAt === null && value.notifiedAt === null && value.completedAt === null && value.dismissedAt === null && value.lastError !== null;
		case "completed": return value.deliveringAt === null && value.notifiedAt === null && value.completedAt !== null && value.dismissedAt === null && value.lastError === null;
		case "dismissed": return value.deliveringAt === null && value.notifiedAt === null && value.completedAt === null && value.dismissedAt !== null && value.lastError === null;
	}
	return false;
}
function isPluginReminderTarget(value) {
	return isRecord$7(value) && safeId$1(value.id) && isPluginReminderLink(value) && safeDisplayText$4(value.label, 800);
}
function isPluginReminderLink(value) {
	if (!isRecord$7(value)) return false;
	if (value.kind === "standalone") return value.path === null && value.noteTitle === null && value.line === null;
	if (![
		"note",
		"heading",
		"task"
	].includes(String(value.kind)) || !safePath$3(value.path) || !safeSingleLine$3(value.noteTitle, 200)) return false;
	return value.kind === "note" ? value.line === null : positiveInteger$3(value.line);
}
function isPluginReminderRecurrence(value) {
	return isRecord$7(value) && positiveInteger$3(value.interval) && value.interval <= 999 && [
		"minute",
		"hour",
		"day",
		"week",
		"month",
		"year"
	].includes(String(value.unit));
}
function isNullableRecurrence(value) {
	return value === null || isPluginReminderRecurrence(value);
}
function isPluginReminderSchedule(value) {
	if (!isRecord$7(value) || !isReminderTimeZone(value.timeZone)) return false;
	if (value.kind === "wall-clock") return isReminderLocalDateTime(value.localDateTime);
	return value.kind === "instant" && isTimestamp(value.dueAt);
}
function isNotices(value) {
	return Array.isArray(value) && value.length <= 16 && value.every((notice) => safeDisplayText$4(notice, 2048));
}
function safeId$1(value) {
	return safeSingleLine$3(value, 256);
}
function isWorkspaceId(value) {
	return safeSingleLine$3(value, 128);
}
function safePath$3(value) {
	return typeof value === "string" && value.length > 0 && value.length <= 1024 && value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== ".." && segment !== ".denote" && segment !== ".git" && !segment.includes("\\") && SAFE_TEXT$4.test(segment));
}
function safeSingleLine$3(value, maxLength) {
	return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength && !value.includes("\n") && !value.includes("\r") && SAFE_TEXT$4.test(value);
}
function safeDisplayText$4(value, maxBytes) {
	return typeof value === "string" && value.trim().length > 0 && stringBytes$4(value) <= maxBytes && SAFE_TEXT$4.test(value);
}
function isTimestamp(value) {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 864e13;
}
function isNullableTimestamp(value) {
	return value === null || isTimestamp(value);
}
function positiveInteger$3(value) {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function nonNegativeInteger$3(value) {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function stringBytes$4(value) {
	return new TextEncoder().encode(value).byteLength;
}
function isRecord$7(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
// src/clocks.ts
var MAX_PLUGIN_COUNTDOWNS = 32;
var MAX_PLUGIN_ALARMS = 32;
var MAX_PLUGIN_COUNTDOWN_MS = 6048e5;
var CLOCKS_STOP_KEY = "host.clocks-stop.v1";
var CLOCK_CONTENT_CAPABILITIES = [
	"structured-viewer",
	"kanban-board",
	"task-list",
	"note-graph",
	"calendar",
	"diagram-renderer",
	"code-intelligence",
	"text-styling",
	"note-comments",
	"presentation",
	"tooling",
	"terminal"
];
function emptyClockModel() {
	return {
		stopwatch: {
			status: "idle",
			elapsedMs: 0,
			recoveryNotice: null
		},
		countdowns: [],
		alarms: [],
		notices: []
	};
}
function pendingClockDelivery() {
	return {
		status: "pending",
		attempts: 0,
		error: null
	};
}
function isPluginClockRegistration(value) {
	return record$3(value) && line(value.id, 160) && line(value.title, 160);
}
function isPluginClockRequest(value) {
	if (!record$3(value) || !isPluginTimeTrackingClock(value.clock)) return false;
	const mutation = value.mutation;
	if (mutation === void 0) return true;
	if (!record$3(mutation)) return false;
	switch (mutation.type) {
		case "stopwatch-start":
		case "stopwatch-pause":
		case "stopwatch-reset": return true;
		case "countdown-create": return line(mutation.id, 160) && line(mutation.title, 160) && duration(mutation.durationMs) && typeof mutation.sound === "boolean";
		case "countdown-pause":
		case "countdown-resume":
		case "countdown-restart":
		case "countdown-cancel":
		case "countdown-dismiss":
		case "countdown-remove":
		case "alarm-dismiss":
		case "alarm-snooze":
		case "alarm-remove": return actionId(mutation);
		case "alarm-create": return line(mutation.id, 160) && alarmInput(mutation);
		case "alarm-update": return line(mutation.id, 160) && integer$2(mutation.expectedRevision) && alarmInput(mutation);
		case "alarm-toggle": return actionId(mutation) && typeof mutation.enabled === "boolean";
		case "notification-started":
		case "notification-succeeded":
		case "notification-retry": return target(mutation);
		case "notification-failed": return target(mutation) && displayText(mutation.error, 2048);
		default: return false;
	}
}
function isPluginClockModel(value) {
	if (!record$3(value) || !record$3(value.stopwatch) || ![
		"idle",
		"running",
		"paused"
	].includes(String(value.stopwatch.status)) || !integer$2(value.stopwatch.elapsedMs) || !nullableNotice(value.stopwatch.recoveryNotice) || value.stopwatch.status === "idle" && value.stopwatch.elapsedMs !== 0 || !Array.isArray(value.countdowns) || value.countdowns.length > 32 || !Array.isArray(value.alarms) || value.alarms.length > 32 || !Array.isArray(value.notices) || value.notices.length > 16 || !value.notices.every((notice) => displayText(notice, 1e3))) return false;
	const ids = /* @__PURE__ */ new Set();
	for (const countdown of value.countdowns) {
		if (!clockRecord(countdown) || !record$3(countdown) || ids.has(countdown.id) || !duration(countdown.durationMs) || !integer$2(countdown.remainingMs) || countdown.remainingMs > countdown.durationMs || ![
			"running",
			"paused",
			"ringing",
			"finished",
			"cancelled"
		].includes(String(countdown.status)) || !nullableNotice(countdown.recoveryNotice) || (countdown.status === "ringing" || countdown.status === "finished") && countdown.remainingMs !== 0 || countdown.status === "running" && countdown.remainingMs === 0) return false;
		ids.add(countdown.id);
	}
	for (const alarm of value.alarms) {
		if (!clockRecord(alarm) || !record$3(alarm) || ids.has(alarm.id) || !alarmInput(alarm) || !timestamp(alarm.dueAt) || !integer$2(alarm.revision) || ![
			"scheduled",
			"ringing",
			"disabled"
		].includes(String(alarm.status)) || alarm.snoozedUntil !== null && !timestamp(alarm.snoozedUntil)) return false;
		ids.add(alarm.id);
	}
	try {
		return new TextEncoder().encode(JSON.stringify(value)).byteLength <= 131072;
	} catch (error) {
		if (error instanceof TypeError || error instanceof RangeError) return false;
		throw error;
	}
}
function ringingClocks(model) {
	return [...model.countdowns.filter((row) => row.status === "ringing").map((row) => ({
		...row,
		kind: "countdown"
	})), ...model.alarms.filter((row) => row.status === "ringing").map((row) => ({
		...row,
		kind: "alarm"
	}))].map(({ kind, id, occurrence, title, sound, delivery }) => ({
		kind,
		id,
		occurrence,
		title,
		sound,
		delivery
	}));
}
function alarmInput(value) {
	return line(value.title, 160) && isReminderLocalDateTime(value.localDateTime) && isReminderTimeZone(value.timeZone) && typeof value.repeatDaily === "boolean" && typeof value.sound === "boolean";
}
function clockRecord(value) {
	if (!record$3(value) || !line(value.id, 160) || !line(value.title, 160) || typeof value.sound !== "boolean" || !integer$2(value.occurrence) || value.occurrence < 1 || !timestamp(value.createdAt) || !timestamp(value.updatedAt) || !record$3(value.delivery) || !integer$2(value.delivery.attempts) || value.delivery.attempts > 1e4 || ![
		"pending",
		"sending",
		"sent",
		"failed"
	].includes(String(value.delivery.status))) return false;
	return value.delivery.status === "failed" ? displayText(value.delivery.error, 2048) : value.delivery.error === null;
}
function target(value) {
	return (value.kind === "countdown" || value.kind === "alarm") && line(value.id, 160) && integer$2(value.occurrence) && value.occurrence >= 1;
}
function actionId(value) {
	return line(value.id, 160) && (value.occurrence === void 0 || integer$2(value.occurrence) && value.occurrence >= 1);
}
function record$3(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function integer$2(value) {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function timestamp(value) {
	return integer$2(value) && value <= 0xe677d21fdbff;
}
function duration(value) {
	return integer$2(value) && value >= 1e3 && value <= 6048e5;
}
function displayText(value, maximum) {
	return typeof value === "string" && value.trim().length > 0 && value.length <= maximum && /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]*$/u.test(value);
}
function line(value, maximum) {
	return displayText(value, maximum) && !/[\r\n]/u.test(value);
}
function nullableNotice(value) {
	return value === null || displayText(value, 1e3);
}
// src/validation.ts
function validatePluginBundles(value, catalogPluginIds) {
	if (!Array.isArray(value)) return invalid("Plugin bundles must be an array.");
	const errors = [];
	const bundleIds = /* @__PURE__ */ new Set();
	const bundleNames = /* @__PURE__ */ new Set();
	for (const [bundleIndex, bundle] of value.entries()) {
		const field = `bundles[${bundleIndex}]`;
		if (!isRecord$6(bundle)) {
			errors.push(`${field} must be an object.`);
			continue;
		}
		validateStableId(bundle.id, `${field}.id`, errors);
		requireString(bundle.name, `${field}.name`, errors);
		trackUniqueString(bundle.id, `${field}.id`, bundleIds, errors);
		trackUniqueName(bundle.name, `${field}.name`, bundleNames, errors);
		if (!Array.isArray(bundle.categories)) errors.push(`${field}.categories must be an array.`);
		else {
			const categories = /* @__PURE__ */ new Set();
			for (const [categoryIndex, category] of bundle.categories.entries()) if (typeof category !== "string" || !PLUGIN_CATEGORIES.includes(category)) errors.push(`${field}.categories[${categoryIndex}] must be one of: ${PLUGIN_CATEGORIES.join(", ")}.`);
			else if (categories.has(category)) errors.push(`${field}.categories contains duplicate ${category}.`);
			else categories.add(category);
		}
		if (!Array.isArray(bundle.roles) || bundle.roles.length === 0) {
			errors.push(`${field}.roles must be a non-empty array.`);
			continue;
		}
		const roleIds = /* @__PURE__ */ new Set();
		const roleNames = /* @__PURE__ */ new Set();
		for (const [roleIndex, role] of bundle.roles.entries()) {
			const roleField = `${field}.roles[${roleIndex}]`;
			if (!isRecord$6(role)) {
				errors.push(`${roleField} must be an object.`);
				continue;
			}
			validateStableId(role.id, `${roleField}.id`, errors);
			requireString(role.name, `${roleField}.name`, errors);
			trackUniqueString(role.id, `${roleField}.id`, roleIds, errors);
			trackUniqueName(role.name, `${roleField}.name`, roleNames, errors);
			if (!Array.isArray(role.candidatePluginIds)) {
				errors.push(`${roleField}.candidatePluginIds must be an array.`);
				continue;
			}
			const candidates = /* @__PURE__ */ new Set();
			for (const [candidateIndex, candidate] of role.candidatePluginIds.entries()) {
				const candidateField = `${roleField}.candidatePluginIds[${candidateIndex}]`;
				if (typeof candidate !== "string") {
					errors.push(`${candidateField} must be a string.`);
					continue;
				}
				if (candidates.has(candidate)) errors.push(`${roleField}.candidatePluginIds contains duplicate ${candidate}.`);
				else candidates.add(candidate);
				if (catalogPluginIds && !catalogPluginIds.has(candidate)) errors.push(`${candidateField} references unknown catalog plugin ${candidate}.`);
			}
		}
	}
	return errors.length === 0 ? {
		valid: true,
		value,
		errors
	} : {
		valid: false,
		value: null,
		errors
	};
}
function assertValidPluginBundles(value, catalogPluginIds) {
	const result = validatePluginBundles(value, catalogPluginIds);
	if (!result.valid) throw new Error(`Invalid plugin bundles:\n- ${result.errors.join("\n- ")}`);
}
function validatePluginManifest(value) {
	const errors = [];
	if (!isRecord$6(value)) return invalid("Manifest must be an object.");
	requireEqual(value.schemaVersion, 1, "schemaVersion", errors);
	requireString(value.id, "id", errors);
	if (typeof value.id === "string" && !/^(?=.*\.)[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(value.id)) errors.push("id must be a namespaced lowercase identifier such as denote.example.");
	requireString(value.name, "name", errors);
	requireSemver(value.version, "version", errors);
	requireString(value.description, "description", errors);
	validatePublisher(value.publisher, errors);
	requireString(value.license, "license", errors);
	requireHttpsUrl(value.repository, "repository", errors);
	if (value.homepage !== void 0) requireHttpsUrl(value.homepage, "homepage", errors);
	requireSafeRelativePath(value.icon, "icon", errors);
	if (typeof value.category !== "string" || !PLUGIN_CATEGORIES.includes(value.category)) errors.push(`category must be one of: ${PLUGIN_CATEGORIES.join(", ")}.`);
	validateCompatibility(value.compatibility, errors);
	validatePermissions(value.permissions, errors);
	requireSafeRelativePath(value.entrypoint, "entrypoint", errors);
	if (typeof value.entrypoint === "string" && !value.entrypoint.startsWith("dist/")) errors.push("entrypoint must point inside the package dist/ directory.");
	if (value.diagramRenderer !== void 0) {
		if (!isRecord$6(value.diagramRenderer)) errors.push("diagramRenderer must be an object.");
		else {
			requireSafeRelativePath(value.diagramRenderer.entrypoint, "diagramRenderer.entrypoint", errors);
			if (typeof value.diagramRenderer.entrypoint === "string" && !value.diagramRenderer.entrypoint.startsWith("dist/")) errors.push("diagramRenderer.entrypoint must point inside the package dist/ directory.");
			if (value.diagramRenderer.entrypoint === value.entrypoint) errors.push("diagramRenderer.entrypoint must differ from entrypoint.");
		}
	}
	const hasDiagramPermission = Array.isArray(value.permissions) && value.permissions.some((permission) => isRecord$6(permission) && permission.capability === "diagram-renderer");
	if (hasDiagramPermission && value.diagramRenderer === void 0) errors.push("diagram-renderer permission requires diagramRenderer.");
	if (!hasDiagramPermission && value.diagramRenderer !== void 0) errors.push("diagramRenderer requires the diagram-renderer permission.");
	const hasReminderPermission = Array.isArray(value.permissions) && value.permissions.some((permission) => isRecord$6(permission) && permission.capability === "reminders");
	const hasNotificationPermission = Array.isArray(value.permissions) && value.permissions.some((permission) => isRecord$6(permission) && permission.capability === "notifications");
	if (hasReminderPermission && !hasNotificationPermission) errors.push("reminders permission requires notifications permission.");
	const hasClocks = Array.isArray(value.permissions) && value.permissions.some((permission) => isRecord$6(permission) && permission.capability === "clocks");
	if (hasClocks && !hasNotificationPermission) errors.push("clocks permission requires notifications permission.");
	if (hasClocks && Array.isArray(value.permissions) && value.permissions.some((permission) => isRecord$6(permission) && CLOCK_CONTENT_CAPABILITIES.some((capability) => capability === permission.capability))) errors.push("clocks cannot share a worker with content-based capabilities.");
	if (Array.isArray(value.permissions) && value.permissions.some((permission) => isRecord$6(permission) && ["speech", "credential-store"].includes(String(permission.capability))) && value.permissions.length !== 1) errors.push("Sensitive tools require one isolated speech or credential-store permission.");
	if (value.legal !== void 0) {
		if (!Array.isArray(value.legal) || value.legal.length === 0) errors.push("legal must be a non-empty array.");
		else {
			const legalPaths = /* @__PURE__ */ new Set();
			value.legal.forEach((path, index) => {
				requireSafeRelativePath(path, `legal[${index}]`, errors);
				if (typeof path === "string") {
					if (legalPaths.has(path)) errors.push(`legal contains duplicate ${path}.`);
					legalPaths.add(path);
				}
			});
		}
	}
	requireSafeRelativePath(value.documentation, "documentation", errors);
	if (value.settings !== void 0) validateSettings(value.settings, errors);
	return errors.length === 0 ? {
		valid: true,
		value,
		errors
	} : {
		valid: false,
		value: null,
		errors
	};
}
function assertValidPluginManifest(value) {
	const result = validatePluginManifest(value);
	if (!result.valid) throw new Error(`Invalid plugin manifest:\n- ${result.errors.join("\n- ")}`);
}
function parsePluginManifest(value) {
	assertValidPluginManifest(value);
	return value;
}
function validatePluginCatalogEntry(value) {
	if (!isRecord$6(value)) return invalid("Catalog entry must be an object.");
	const errors = validatePluginManifest(value.manifest).errors;
	if (!isRecord$6(value.artifact)) errors.push("artifact must be an object.");
	else {
		requireHttpsUrl(value.artifact.url, "artifact.url", errors);
		if (typeof value.artifact.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(value.artifact.sha256)) errors.push("artifact.sha256 must be a 64-character SHA-256 hex digest.");
		if (!isRecord$6(value.provenance)) errors.push("provenance must be an object.");
		else {
			requireString(value.provenance.publisherId, "provenance.publisherId", errors);
			if (typeof value.provenance.sourceCommit !== "string" || !/^[a-f0-9]{40}$/i.test(value.provenance.sourceCommit)) errors.push("provenance.sourceCommit must be a full 40-character Git commit SHA.");
			if (value.provenance.trusted !== true) errors.push("provenance.trusted must be true for catalog plugins.");
		}
		if (value.revoked !== void 0) {
			if (!isRecord$6(value.revoked)) errors.push("revoked must be an object.");
			else {
				requireString(value.revoked.reason, "revoked.reason", errors);
				requireString(value.revoked.revokedAt, "revoked.revokedAt", errors);
			}
		}
		if (typeof value.artifact.sizeBytes !== "number" || !Number.isSafeInteger(value.artifact.sizeBytes) || value.artifact.sizeBytes <= 0) errors.push("artifact.sizeBytes must be a positive integer.");
	}
	requireString(value.guide, "guide", errors);
	if (typeof value.guide === "string") {
		const guide = value.guide.toLowerCase();
		for (const section of PLUGIN_GUIDE_SECTIONS) if (!guide.includes(`## ${section}`)) errors.push(`guide is missing the "${section}" section.`);
	}
	return errors.length === 0 ? {
		valid: true,
		value,
		errors
	} : {
		valid: false,
		value: null,
		errors
	};
}
function assertValidPluginCatalogEntry(value) {
	const result = validatePluginCatalogEntry(value);
	if (!result.valid) throw new Error(`Invalid plugin catalog entry:\n- ${result.errors.join("\n- ")}`);
}
function checkPluginCompatibility(manifest, denoteVersion, apiVersion) {
	const hostVersion = strictSemver(denoteVersion);
	if (!hostVersion) return {
		compatible: false,
		reason: `Denote host version ${denoteVersion} is not valid semantic versioning.`
	};
	if (manifest.compatibility.apiVersion !== apiVersion) return {
		compatible: false,
		reason: `Plugin API version ${manifest.compatibility.apiVersion} is incompatible with host API version ${apiVersion}.`
	};
	const minimum = strictSemver(manifest.compatibility.minimumDenoteVersion);
	const maximum = manifest.compatibility.maximumDenoteVersion ? strictSemver(manifest.compatibility.maximumDenoteVersion) : null;
	if (!minimum || compare(hostVersion, minimum) < 0) return {
		compatible: false,
		reason: `Plugin requires Denote ${manifest.compatibility.minimumDenoteVersion} or newer.`
	};
	if (maximum && compare(hostVersion, maximum) >= 0) return {
		compatible: false,
		reason: `Plugin requires a Denote version below ${manifest.compatibility.maximumDenoteVersion}.`
	};
	return {
		compatible: true,
		reason: null
	};
}
function validatePublisher(value, errors) {
	if (!isRecord$6(value)) {
		errors.push("publisher must be an object.");
		return;
	}
	requireString(value.name, "publisher.name", errors);
	if (value.url !== void 0) requireHttpsUrl(value.url, "publisher.url", errors);
}
function validateCompatibility(value, errors) {
	if (!isRecord$6(value)) {
		errors.push("compatibility must be an object.");
		return;
	}
	if (typeof value.apiVersion !== "number" || !Number.isSafeInteger(value.apiVersion) || value.apiVersion <= 0) errors.push("compatibility.apiVersion must be a positive integer.");
	requireSemver(value.minimumDenoteVersion, "compatibility.minimumDenoteVersion", errors);
	if (value.maximumDenoteVersion !== void 0) requireSemver(value.maximumDenoteVersion, "compatibility.maximumDenoteVersion", errors);
	const minimum = typeof value.minimumDenoteVersion === "string" ? strictSemver(value.minimumDenoteVersion) : null;
	const maximum = typeof value.maximumDenoteVersion === "string" ? strictSemver(value.maximumDenoteVersion) : null;
	if (minimum && maximum && compare(minimum, maximum) >= 0) errors.push("compatibility.maximumDenoteVersion must be greater than minimumDenoteVersion.");
}
function validatePermissions(value, errors) {
	if (!Array.isArray(value)) {
		errors.push("permissions must be an array.");
		return;
	}
	const seen = /* @__PURE__ */ new Set();
	value.forEach((permission, index) => {
		if (!isRecord$6(permission)) {
			errors.push(`permissions[${index}] must be an object.`);
			return;
		}
		if (typeof permission.capability !== "string" || !PLUGIN_CAPABILITIES.includes(permission.capability)) {
			errors.push(`permissions[${index}].capability must be one of: ${PLUGIN_CAPABILITIES.join(", ")}.`);
			return;
		}
		if (seen.has(permission.capability)) errors.push(`permissions contains duplicate ${permission.capability}.`);
		seen.add(permission.capability);
		if (permission.capability === "network") {
			if (!Array.isArray(permission.hosts) || permission.hosts.length === 0) errors.push(`permissions[${index}].hosts must be a non-empty array.`);
			else permission.hosts.forEach((host, hostIndex) => {
				if (typeof host !== "string" || !validHostPattern(host)) errors.push(`permissions[${index}].hosts[${hostIndex}] is not a valid host pattern.`);
			});
		} else if ("hosts" in permission) errors.push(`permissions[${index}].hosts is only valid for network permission.`);
		if (permission.capability === "process") {
			const executableMap = permission.executables;
			if (!isRecord$6(executableMap) || ![
				"macos",
				"linux",
				"windows"
			].some((platform) => Array.isArray(executableMap[platform]) && executableMap[platform].length > 0)) errors.push(`permissions[${index}].executables must define at least one platform.`);
			else {
				for (const platform of Object.keys(executableMap)) if (![
					"macos",
					"linux",
					"windows"
				].includes(platform)) errors.push(`permissions[${index}].executables contains unknown platform ${platform}.`);
				for (const platform of [
					"macos",
					"linux",
					"windows"
				]) {
					const executables = executableMap[platform];
					if (executables === void 0) continue;
					if (!Array.isArray(executables)) {
						errors.push(`permissions[${index}].executables.${platform} must be an array.`);
						continue;
					}
					executables.forEach((executable, executableIndex) => {
						const absolute = typeof executable === "string" && (platform === "windows" ? /^[A-Za-z]:[\\/]/.test(executable) || executable.startsWith("\\\\") : executable.startsWith("/"));
						if (typeof executable !== "string" || !absolute || executable.includes("\0")) errors.push(`permissions[${index}].executables.${platform}[${executableIndex}] must be an absolute executable path.`);
					});
				}
			}
		} else if ("executables" in permission) errors.push(`permissions[${index}].executables is only valid for process permission.`);
	});
}
function validateSettings(value, errors) {
	if (!isRecord$6(value) || !isRecord$6(value.properties)) {
		errors.push("settings.properties must be an object.");
		return;
	}
	if (typeof value.version !== "number" || !Number.isSafeInteger(value.version) || value.version <= 0) errors.push("settings.version must be a positive integer.");
	for (const [key, definition] of Object.entries(value.properties)) {
		if (!/^[a-z][a-zA-Z0-9]*$/.test(key)) errors.push(`settings property ${key} must use lower camel case.`);
		if (!isRecord$6(definition)) {
			errors.push(`settings.properties.${key} must be an object.`);
			continue;
		}
		requireString(definition.title, `settings.properties.${key}.title`, errors);
		if (definition.description !== void 0) requireString(definition.description, `settings.properties.${key}.description`, errors);
		switch (definition.type) {
			case "boolean":
				if (typeof definition.default !== "boolean") errors.push(`settings.properties.${key}.default must be boolean.`);
				break;
			case "string":
				if (typeof definition.default !== "string") errors.push(`settings.properties.${key}.default must be a string.`);
				if (definition.sensitive !== void 0 && typeof definition.sensitive !== "boolean") errors.push(`settings.properties.${key}.sensitive must be a boolean.`);
				break;
			case "number":
				if (typeof definition.default !== "number" || !Number.isFinite(definition.default)) errors.push(`settings.properties.${key}.default must be a number.`);
				if (definition.minimum !== void 0 && (typeof definition.minimum !== "number" || !Number.isFinite(definition.minimum))) errors.push(`settings.properties.${key}.minimum must be a number.`);
				if (definition.maximum !== void 0 && (typeof definition.maximum !== "number" || !Number.isFinite(definition.maximum))) errors.push(`settings.properties.${key}.maximum must be a number.`);
				if (typeof definition.minimum === "number" && typeof definition.maximum === "number" && definition.minimum > definition.maximum) errors.push(`settings.properties.${key}.minimum cannot exceed maximum.`);
				if (typeof definition.default === "number" && (typeof definition.minimum === "number" && definition.default < definition.minimum || typeof definition.maximum === "number" && definition.default > definition.maximum)) errors.push(`settings.properties.${key}.default must be inside the allowed range.`);
				break;
			case "select":
				if (typeof definition.default !== "string") errors.push(`settings.properties.${key}.default must be a string.`);
				if (!Array.isArray(definition.options) || definition.options.length === 0) errors.push(`settings.properties.${key}.options must be a non-empty array.`);
				else {
					const values = /* @__PURE__ */ new Set();
					for (const [optionIndex, option] of definition.options.entries()) {
						if (!isRecord$6(option) || typeof option.value !== "string" || typeof option.label !== "string") {
							errors.push(`settings.properties.${key}.options[${optionIndex}] must contain string value and label.`);
							continue;
						}
						values.add(option.value);
					}
					if (typeof definition.default === "string" && !values.has(definition.default)) errors.push(`settings.properties.${key}.default must match an option value.`);
				}
				break;
			default: errors.push(`settings.properties.${key}.type must be boolean, string, number, or select.`);
		}
	}
	if (value.migrations !== void 0) {
		if (!Array.isArray(value.migrations)) {
			errors.push("settings.migrations must be an array.");
			return;
		}
		const seen = /* @__PURE__ */ new Set();
		for (const [index, migration] of value.migrations.entries()) {
			if (!isRecord$6(migration)) {
				errors.push(`settings.migrations[${index}] must be an object.`);
				continue;
			}
			if (typeof migration.from !== "number" || !Number.isSafeInteger(migration.from) || typeof migration.to !== "number" || !Number.isSafeInteger(migration.to) || migration.to !== migration.from + 1) errors.push(`settings.migrations[${index}] must advance exactly one integer version.`);
			else if (seen.has(migration.from)) errors.push(`settings.migrations contains duplicate version ${migration.from}.`);
			else seen.add(migration.from);
			if (migration.rename !== void 0 && !isStringRecord(migration.rename)) errors.push(`settings.migrations[${index}].rename must map strings.`);
			if (migration.remove !== void 0 && (!Array.isArray(migration.remove) || migration.remove.some((key) => typeof key !== "string"))) errors.push(`settings.migrations[${index}].remove must contain strings.`);
			if (migration.defaults !== void 0 && !isRecord$6(migration.defaults)) errors.push(`settings.migrations[${index}].defaults must be an object.`);
		}
		if (typeof value.version === "number" && Number.isSafeInteger(value.version)) {
			for (let version = 1; version < value.version; version += 1) if (!seen.has(version)) errors.push(`settings.migrations is missing version ${version} to ${version + 1}.`);
		}
	}
}
function requireEqual(value, expected, field, errors) {
	if (value !== expected) errors.push(`${field} must be ${String(expected)}.`);
}
function requireString(value, field, errors) {
	if (typeof value !== "string" || value.trim().length === 0) errors.push(`${field} must be a non-empty string.`);
}
function validateStableId(value, field, errors) {
	if (typeof value !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) errors.push(`${field} must be a stable kebab-case ID.`);
}
function trackUniqueString(value, field, seen, errors) {
	if (typeof value === "string" && seen.has(value)) errors.push(`${field} duplicates ${value}.`);
	else if (typeof value === "string") seen.add(value);
}
function trackUniqueName(value, field, seen, errors) {
	if (typeof value !== "string" || value.trim().length === 0) return;
	const normalized = value.trim().toLocaleLowerCase();
	if (seen.has(normalized)) errors.push(`${field} duplicates the name ${value}.`);
	else seen.add(normalized);
}
function requireHttpsUrl(value, field, errors) {
	if (typeof value !== "string") {
		errors.push(`${field} must be an HTTPS URL.`);
		return;
	}
	try {
		if (new URL(value).protocol !== "https:") errors.push(`${field} must be an HTTPS URL.`);
	} catch {
		errors.push(`${field} must be an HTTPS URL.`);
	}
}
function requireSafeRelativePath(value, field, errors) {
	if (typeof value !== "string" || value.length === 0 || value.startsWith("/") || value.includes("\\") || value.split("/").some((part) => part === "" || part === "." || part === "..")) errors.push(`${field} must be a safe package-relative path.`);
}
function requireSemver(value, field, errors) {
	if (typeof value !== "string" || strictSemver(value) === null) errors.push(`${field} must be a semantic version.`);
}
function strictSemver(value) {
	if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(value)) return null;
	return valid(value);
}
function invalid(message) {
	return {
		valid: false,
		value: null,
		errors: [message]
	};
}
function isRecord$6(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isStringRecord(value) {
	return isRecord$6(value) && Object.values(value).every((entry) => typeof entry === "string");
}
function validHostPattern(value) {
	const host = value.startsWith("*.") ? value.slice(2) : value;
	return host.length > 0 && host.length <= 253 && /^[a-z0-9.-]+$/i.test(host) && !host.startsWith(".") && !host.startsWith("-") && !host.endsWith(".") && !host.endsWith("-") && !host.includes("..");
}
// src/emoji.ts
var EMOJI_MAX_ENTRIES = 5e3;
var EMOJI_MAX_RECENTS = 32;
var EMOJI_MAX_FAVORITES = 128;
var MAX_DATASET_BYTES = 2097152;
var segmenter;
var identifier = /^[a-z0-9][a-z0-9._-]{0,99}$/;
var shortcode = /^[a-z0-9_+-]{2,80}$/;
var pictograph = /\p{Extended_Pictographic}/u;
var emojiCharacters = /^[\p{Extended_Pictographic}\p{Emoji_Modifier}\u200d\ufe0e\ufe0f\u{e0020}-\u{e007f}]+$/u;
function isEmojiSequence(value) {
	if (typeof value !== "string" || value.length === 0 || value.length > 64) return false;
	if (/^[#*0-9]\ufe0f?\u20e3$/u.test(value)) return true;
	if (/^[\u{1f1e6}-\u{1f1ff}]{2}$/u.test(value)) return true;
	segmenter ??= new Intl.Segmenter("en", { granularity: "grapheme" });
	return pictograph.test(value) && emojiCharacters.test(value) && [...segmenter.segment(value)].length === 1 && !/^[\u200d\ufe0e\ufe0f\p{Emoji_Modifier}]|\u200d$/u.test(value);
}
function isPluginEmojiPicker(value) {
	if (!record$2(value) || !keys(value, [
		"id",
		"title",
		"entries",
		"shortcodes",
		"settingsKeys"
	]) || typeof value.id !== "string" || !identifier.test(value.id) || !label(value.title, 100) || typeof value.shortcodes !== "boolean" || !record$2(value.settingsKeys) || !keys(value.settingsKeys, [
		"recents",
		"favorites",
		"tone"
	]) || !Object.values(value.settingsKeys).every((key) => typeof key === "string" && identifier.test(key)) || new Set(Object.values(value.settingsKeys)).size !== 3 || !plainArray(value.entries, 5e3) || value.entries.length === 0 || !value.entries.every(entry)) return false;
	if (new Set(value.entries.map((item) => item.id)).size !== value.entries.length) return false;
	return new TextEncoder().encode(JSON.stringify(value)).length <= MAX_DATASET_BYTES;
}
function emojiPickerMatchesManifest(picker, manifest) {
	const properties = manifest.settings?.properties;
	const recent = properties?.[picker.settingsKeys.recents];
	const favorite = properties?.[picker.settingsKeys.favorites];
	const tone = properties?.[picker.settingsKeys.tone];
	return picker.id.startsWith(`${manifest.id}.`) && recent?.type === "string" && recent.default === "[]" && favorite?.type === "string" && favorite.default === "[]" && tone?.type === "number" && tone.minimum === 0 && tone.maximum === 5 && Number.isInteger(tone.default);
}
function isPluginEmojiPreferences(value) {
	return record$2(value) && keys(value, [
		"recents",
		"favorites",
		"tone"
	]) && sequences(value.recents, 32) && sequences(value.favorites, 128) && typeof value.tone === "number" && Number.isInteger(value.tone) && value.tone >= 0 && value.tone <= 5;
}
function sequences(value, limit) {
	return plainArray(value, limit) && value.every(isEmojiSequence) && new Set(value).size === value.length;
}
function entry(value) {
	return record$2(value) && keys(value, [
		"id",
		"name",
		"unicode",
		"category",
		"keywords",
		"shortcodes",
		"variants"
	]) && typeof value.id === "string" && identifier.test(value.id) && label(value.name, 160) && isEmojiSequence(value.unicode) && label(value.category, 80) && plainArray(value.keywords, 32) && value.keywords.every((item) => label(item, 80)) && plainArray(value.shortcodes, 32) && value.shortcodes.length > 0 && value.shortcodes.every((item) => typeof item === "string" && shortcode.test(item)) && plainArray(value.variants, 30) && value.variants.every(variant) && new Set(value.variants.map((item) => item.unicode)).size === value.variants.length;
}
function variant(value) {
	return record$2(value) && keys(value, ["name", "unicode"], ["tone"]) && label(value.name, 160) && isEmojiSequence(value.unicode) && (value.tone === void 0 || typeof value.tone === "number" && Number.isInteger(value.tone) && value.tone >= 1 && value.tone <= 5);
}
function label(value, limit) {
	return typeof value === "string" && value.trim().length > 0 && value.length <= limit && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value);
}
function keys(value, required, optional = []) {
	return required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
}
function record$2(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function plainArray(value, maximum) {
	if (!Array.isArray(value) || value.length > maximum) return false;
	const ownKeys = Reflect.ownKeys(value);
	return ownKeys.length === value.length + 1 && ownKeys.every((key) => key === "length" || typeof key === "string" && /^(0|[1-9]\d*)$/.test(key) && Number(key) < value.length);
}
// src/structuredViewer.ts
var MAX_PLUGIN_STRUCTURED_VIEWER_EXTENSIONS = 16;
var MAX_PLUGIN_STRUCTURED_VIEWER_NODES = 5e4;
var MAX_PLUGIN_STRUCTURED_VIEWER_MODEL_BYTES = 8388608;
var MAX_PLUGIN_STRUCTURED_VIEWER_SOURCE_BYTES = 4194304;
var CONTAINER_TYPES = /* @__PURE__ */ new Set([
	"object",
	"array",
	"mapping",
	"sequence",
	"stream"
]);
var SCALAR_TYPES = /* @__PURE__ */ new Set([
	"string",
	"number",
	"boolean",
	"null",
	"scalar",
	"alias"
]);
var STRUCTURED_VIEWER_EXTENSIONS = /* @__PURE__ */ new Set([
	"json",
	"yaml",
	"yml"
]);
var SAFE_TEXT$3 = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]*$/u;
function isPluginStructuredViewerRegistration(value) {
	if (!isRecord$5(value)) return false;
	if (!safeText(value.id, 160) || !safeText(value.title, 160) || !Array.isArray(value.extensions) || value.extensions.length === 0 || value.extensions.length > 16) return false;
	const extensions = /* @__PURE__ */ new Set();
	for (const extension of value.extensions) {
		if (typeof extension !== "string" || !/^[a-z0-9][a-z0-9+-]{0,15}$/.test(extension) || !STRUCTURED_VIEWER_EXTENSIONS.has(extension) || extensions.has(extension)) return false;
		extensions.add(extension);
	}
	return true;
}
function isPluginStructuredViewModel(value) {
	if (!isRecord$5(value) || typeof value.truncated !== "boolean" || !Array.isArray(value.notices) || value.notices.length > 16 || !value.notices.every((notice) => safeText(notice, 512)) || !Array.isArray(value.nodes) || value.nodes.length > 5e4) return false;
	let modelBytes = value.notices.reduce((total, notice) => total + stringBytes$3(notice), 0);
	if (value.error !== null) {
		if (value.rootId !== null || value.nodes.length !== 0 || !isParseError(value.error)) return false;
		modelBytes += parseErrorBytes(value.error);
		return modelBytes <= MAX_PLUGIN_STRUCTURED_VIEWER_MODEL_BYTES;
	}
	if (typeof value.rootId !== "string" || value.nodes.length === 0 || value.nodes[0]?.id !== value.rootId) return false;
	const nodes = /* @__PURE__ */ new Map();
	const directChildren = /* @__PURE__ */ new Map();
	for (const candidate of value.nodes) {
		if (!isStructuredNode(candidate) || nodes.has(candidate.id)) return false;
		if (candidate.parentId === null) {
			if (candidate.id !== value.rootId || candidate.depth !== 0) return false;
		} else {
			const parent = nodes.get(candidate.parentId);
			if (!parent || candidate.depth !== parent.depth + 1) return false;
			directChildren.set(candidate.parentId, (directChildren.get(candidate.parentId) ?? 0) + 1);
		}
		nodes.set(candidate.id, candidate);
		modelBytes += structuredNodeBytes(candidate);
		if (modelBytes > 8388608) return false;
	}
	for (const node of nodes.values()) if (node.childCount !== (directChildren.get(node.id) ?? 0)) return false;
	return true;
}
function isStructuredNode(value) {
	if (!isRecord$5(value) || !safeText(value.id, 256) || !(value.parentId === null || safeText(value.parentId, 256)) || !safeDisplayText$3(value.label, 512) || typeof value.type !== "string" || !CONTAINER_TYPES.has(value.type) && !SCALAR_TYPES.has(value.type) || !nonNegativeInteger$2(value.depth) || value.depth > 256 || !nonNegativeInteger$2(value.childCount) || !(value.anchor === void 0 || safeText(value.anchor, 128))) return false;
	return CONTAINER_TYPES.has(value.type) ? value.value === void 0 : safeDisplayText$3(value.value, 4096) && value.childCount === 0;
}
function isParseError(value) {
	return isRecord$5(value) && safeText(value.message, 1024) && (value.line === void 0 || positiveInteger$2(value.line)) && (value.column === void 0 || positiveInteger$2(value.column)) && (value.code === void 0 || safeText(value.code, 80));
}
function safeText(value, maxLength) {
	return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength && SAFE_TEXT$3.test(value);
}
function safeDisplayText$3(value, maxLength) {
	return typeof value === "string" && value.length <= maxLength && SAFE_TEXT$3.test(value);
}
function positiveInteger$2(value) {
	return Number.isSafeInteger(value) && Number(value) > 0;
}
function nonNegativeInteger$2(value) {
	return Number.isSafeInteger(value) && Number(value) >= 0;
}
function structuredNodeBytes(node) {
	return [
		node.id,
		node.parentId ?? "",
		node.label,
		node.type,
		node.value ?? "",
		node.anchor ?? ""
	].reduce((total, text) => total + stringBytes$3(text), 32);
}
function parseErrorBytes(error) {
	return stringBytes$3(String(error.message)) + stringBytes$3(String(error.code ?? "")) + 32;
}
function stringBytes$3(value) {
	return new TextEncoder().encode(value).byteLength;
}
function isRecord$5(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
// src/kanban.ts
var MAX_PLUGIN_KANBAN_FILE_SUFFIXES = 4;
var MAX_PLUGIN_KANBAN_SOURCE_BYTES = 4194304;
var MAX_PLUGIN_KANBAN_MODEL_BYTES = 8388608;
var MAX_PLUGIN_KANBAN_COLUMNS = 128;
var MAX_PLUGIN_KANBAN_CARDS = 5e3;
var MAX_PLUGIN_KANBAN_CARD_BODY_BYTES = 65536;
var MAX_PLUGIN_KANBAN_TAGS_PER_CARD = 32;
var MAX_PLUGIN_KANBAN_LINKS_PER_CARD = 32;
var SAFE_TEXT$2 = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]*$/u;
var SAFE_ID = /^[a-z0-9][a-z0-9._-]{0,159}$/;
var FILE_SUFFIX = /^\.[a-z0-9][a-z0-9.-]{0,30}\.(?:md|markdown)$/;
function detectPluginKanbanSourceFormat(source) {
	const sample = source.slice(0, 8192);
	if (!sample.includes("denote-kanban:board:v1:start") && !sample.includes("kanban-plugin:")) return null;
	const bytes = new TextEncoder().encode(sample);
	const lines = new TextDecoder().decode(bytes.subarray(0, 8192)).split(/\r\n?|\n/);
	if (source.length > sample.length || bytes.byteLength > 8192) lines.pop();
	let fence = null;
	for (const line of lines) {
		const match = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(line);
		if (match) {
			if (!fence) fence = {
				marker: match[1][0],
				length: match[1].length
			};
			else if (match[1][0] === fence.marker && match[1].length >= fence.length && match[2].trim().length === 0) fence = null;
			continue;
		}
		if (!fence && !/^(?: {4}|\t)/.test(line) && line.replace(/^\uFEFF/, "").trim() === "<!-- denote-kanban:board:v1:start -->") return "denote-kanban-v1";
	}
	const delimiter = lines[0]?.replace(/^\uFEFF/, "").trimEnd();
	if (delimiter !== "---" && delimiter !== "\\---") return null;
	const end = lines.findIndex((line, index) => index > 0 && line.trimEnd() === delimiter);
	return end > 0 && lines.slice(1, end).some((line) => /^kanban-plugin:[ \t]*(?:board|"board"|'board')[ \t]*(?:#.*)?$/.test(line)) ? "obsidian-kanban" : null;
}
function isPluginKanbanRegistration(value) {
	if (!isRecord$4(value) || !safeSingleLine$2(value.id, 160) || !safeSingleLine$2(value.title, 160) || !Array.isArray(value.fileSuffixes) || value.fileSuffixes.length === 0 || value.fileSuffixes.length > 4 || !safeSingleLine$2(value.defaultFileName, 128) || value.sourceFormats !== void 0 && (!Array.isArray(value.sourceFormats) || value.sourceFormats.length === 0 || value.sourceFormats.length > 2 || new Set(value.sourceFormats).size !== value.sourceFormats.length || !value.sourceFormats.every(isKanbanSourceFormat))) return false;
	const defaultFileName = value.defaultFileName;
	if (defaultFileName.includes("/") || defaultFileName.includes("\\")) return false;
	const suffixes = /* @__PURE__ */ new Set();
	for (const suffix of value.fileSuffixes) {
		if (typeof suffix !== "string" || suffix !== suffix.toLowerCase() || !FILE_SUFFIX.test(suffix) || suffixes.has(suffix)) return false;
		suffixes.add(suffix);
	}
	return [...suffixes].some((suffix) => defaultFileName.toLowerCase().endsWith(suffix));
}
function isPluginKanbanBoardModel(value) {
	if (!isRecord$4(value) || !safeDisplayText$2(value.title, 200) || value.sourceFormat !== void 0 && !isKanbanSourceFormat(value.sourceFormat) || typeof value.canInitialize !== "boolean" || !Array.isArray(value.notices) || value.notices.length > 16 || !value.notices.every((notice) => safeDisplayText$2(notice, 512)) || !Array.isArray(value.columns) || value.columns.length > 128) return false;
	let bytes = stringBytes$2(value.title);
	for (const notice of value.notices) bytes += stringBytes$2(notice);
	if (value.error !== null) return !value.canInitialize && value.title === "" && value.columns.length === 0 && value.sourceFormat === void 0 && isKanbanError(value.error) && bytes + errorBytes(value.error) <= 8388608;
	if (value.canInitialize) return value.title === "" && value.columns.length === 0 && value.sourceFormat === void 0 && bytes <= 8388608;
	if (!safeSingleLine$2(value.title, 200)) return false;
	const ids = /* @__PURE__ */ new Set();
	let cardCount = 0;
	for (const column of value.columns) {
		if (!isKanbanColumn(column, ids)) return false;
		bytes += columnBytes(column);
		cardCount += column.cards.length;
		if (cardCount > 5e3 || bytes > 8388608) return false;
	}
	return true;
}
function isPluginKanbanEditRequest(value) {
	return isRecord$4(value) && safePath$2(value.path) && sourceWithinLimit(value.source) && isPluginKanbanEdit(value.edit);
}
function isPluginKanbanEditResult(value) {
	return isRecord$4(value) && sourceWithinLimit(value.source) && isPluginKanbanBoardModel(value.model);
}
function isPluginKanbanEdit(value) {
	if (!isRecord$4(value) || typeof value.type !== "string") return false;
	switch (value.type) {
		case "migrate": return safeTitle(value.title);
		case "initialize": return safeTitle(value.title) && safeTitle(value.initialColumnTitle);
		case "rename-board": return safeTitle(value.title);
		case "add-column": return safeTitle(value.title) && nullableId(value.beforeColumnId);
		case "rename-column": return safeId(value.columnId) && safeTitle(value.title);
		case "delete-column": return safeId(value.columnId);
		case "move-column": return safeId(value.columnId) && nullableId(value.beforeColumnId);
		case "add-card": return safeId(value.columnId) && safeTitle(value.title) && safeBody(value.body) && nullableId(value.beforeCardId);
		case "edit-card": return safeId(value.cardId) && safeTitle(value.title) && safeBody(value.body);
		case "set-card-completed": return safeId(value.cardId) && typeof value.completed === "boolean";
		case "delete-card": return safeId(value.cardId);
		case "move-card": return safeId(value.cardId) && safeId(value.targetColumnId) && nullableId(value.beforeCardId);
		default: return false;
	}
}
function isPluginKanbanBoardRequest(value) {
	return isRecord$4(value) && safePath$2(value.path) && sourceWithinLimit(value.source);
}
function isKanbanColumn(value, ids) {
	if (!isRecord$4(value) || !safeId(value.id) || ids.has(value.id) || !safeTitle(value.title) || !Array.isArray(value.cards) || value.cards.length > 5e3) return false;
	ids.add(value.id);
	return value.cards.every((card) => isKanbanCard(card, ids));
}
function isKanbanCard(value, ids) {
	if (!isRecord$4(value) || !safeId(value.id) || ids.has(value.id) || !safeTitle(value.title) || !safeBody(value.body) || value.completed !== void 0 && typeof value.completed !== "boolean" || !Array.isArray(value.tags) || value.tags.length > 32 || !value.tags.every((tag) => safeSingleLine$2(tag, 80)) || !Array.isArray(value.links) || value.links.length > 32 || !value.links.every((link) => isRecord$4(link) && safeDisplayText$2(link.label, 160) && safeDisplayText$2(link.href, 1024))) return false;
	ids.add(value.id);
	return true;
}
function isKanbanError(value) {
	return isRecord$4(value) && safeDisplayText$2(value.message, 1024) && value.message.length > 0 && (value.line === void 0 || positiveInteger$1(value.line)) && (value.column === void 0 || positiveInteger$1(value.column)) && (value.code === void 0 || safeSingleLine$2(value.code, 80));
}
function errorBytes(value) {
	return stringBytes$2(String(value.message)) + stringBytes$2(String(value.code ?? "")) + 32;
}
function columnBytes(column) {
	return column.cards.reduce((total, card) => total + stringBytes$2(card.id) + stringBytes$2(card.title) + stringBytes$2(card.body) + card.tags.reduce((sum, tag) => sum + stringBytes$2(tag), 0) + card.links.reduce((sum, link) => sum + stringBytes$2(link.label) + stringBytes$2(link.href), 0) + 48, stringBytes$2(column.id) + stringBytes$2(column.title) + 24);
}
function safeId(value) {
	return typeof value === "string" && SAFE_ID.test(value);
}
function isKanbanSourceFormat(value) {
	return value === "denote-kanban-v1" || value === "obsidian-kanban";
}
function nullableId(value) {
	return value === null || safeId(value);
}
function safeTitle(value) {
	return safeSingleLine$2(value, 200);
}
function safeBody(value) {
	return typeof value === "string" && value.length <= 65536 && stringBytes$2(value) <= 65536;
}
function safePath$2(value) {
	return safeDisplayText$2(value, 4096) && value.length > 0 && !value.startsWith("/") && !value.startsWith("\\");
}
function safeSingleLine$2(value, maxLength) {
	return safeDisplayText$2(value, maxLength) && value.trim().length > 0 && !/[\r\n]/.test(value);
}
function safeDisplayText$2(value, maxLength) {
	return typeof value === "string" && value.length <= maxLength && SAFE_TEXT$2.test(value);
}
function sourceWithinLimit(value) {
	return typeof value === "string" && stringBytes$2(value) <= 4194304;
}
function positiveInteger$1(value) {
	return Number.isSafeInteger(value) && Number(value) > 0;
}
function stringBytes$2(value) {
	return new TextEncoder().encode(value).byteLength;
}
function isRecord$4(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
// src/taskList.ts
var MAX_PLUGIN_TASK_LIST_DOCUMENTS = 5e3;
var MAX_PLUGIN_TASK_LIST_SOURCE_BYTES = 262144;
var MAX_PLUGIN_TASK_LIST_INDEX_BYTES = 524288;
var MAX_PLUGIN_TASK_LIST_INDEX_DOCUMENTS = 256;
var MAX_PLUGIN_TASK_LIST_INDEX_REMOVALS = 512;
var MAX_PLUGIN_TASK_LIST_TOTAL_SOURCE_BYTES = 8388608;
var MAX_PLUGIN_TASK_LIST_TASKS = 1e3;
var MAX_PLUGIN_TASK_LIST_TAGS = 256;
var MAX_PLUGIN_TASK_LIST_TAGS_PER_TASK = 32;
var MAX_PLUGIN_TASK_LIST_HEADING_DEPTH = 12;
var MAX_PLUGIN_TASK_LIST_SOURCE_LINE_BYTES = 8192;
var SAFE_TEXT$1 = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]*$/u;
function isPluginTaskListRegistration(value) {
	return isRecord$3(value) && safeSingleLine$1(value.id, 160) && safeSingleLine$1(value.title, 160);
}
function isPluginTaskListIndexRequest(value) {
	if (!isRecord$3(value) || value.mode !== "replace" && value.mode !== "update" || !Array.isArray(value.documents) || value.documents.length > 256 || !Array.isArray(value.removedPaths) || value.removedPaths.length > 512 || !nonNegativeInteger$1(value.skippedCount) || typeof value.truncated !== "boolean") return false;
	const documentPaths = /* @__PURE__ */ new Set();
	let sourceBytes = 0;
	for (const document of value.documents) {
		if (!isPluginTaskListDocument(document) || documentPaths.has(document.path)) return false;
		documentPaths.add(document.path);
		sourceBytes += stringBytes$1(document.source);
		if (sourceBytes > 524288) return false;
	}
	const removedPaths = /* @__PURE__ */ new Set();
	for (const path of value.removedPaths) {
		if (!safePath$1(path) || documentPaths.has(path) || removedPaths.has(path)) return false;
		removedPaths.add(path);
	}
	return value.mode !== "replace" || removedPaths.size === 0;
}
function isPluginTaskListQuery(value) {
	return isRecord$3(value) && [
		"all",
		"open",
		"completed"
	].includes(String(value.status)) && (value.tag === null || safeSingleLine$1(value.tag, 80)) && typeof value.path === "string" && value.path.length <= 512 && SAFE_TEXT$1.test(value.path) && [
		"all",
		"overdue",
		"today",
		"upcoming",
		"undated"
	].includes(String(value.due)) && isTaskListDate(value.today) && isTimeZone(value.timeZone);
}
function isPluginTaskListModel(value) {
	if (!isRecord$3(value) || !Array.isArray(value.tasks) || value.tasks.length > 1e3 || !nonNegativeInteger$1(value.totalTasks) || !nonNegativeInteger$1(value.matchingTasks) || value.totalTasks < value.matchingTasks || value.matchingTasks < value.tasks.length || !Array.isArray(value.availableTags) || value.availableTags.length > 256 || !value.availableTags.every((tag) => safeSingleLine$1(tag, 80)) || new Set(value.availableTags).size !== value.availableTags.length || typeof value.truncated !== "boolean" || !Array.isArray(value.notices) || value.notices.length > 16 || !value.notices.every((notice) => safeDisplayText$1(notice, 512))) return false;
	const ids = /* @__PURE__ */ new Set();
	return value.tasks.every((task) => {
		if (!isPluginTaskListItem(task) || ids.has(task.id)) return false;
		ids.add(task.id);
		return true;
	});
}
function isPluginTaskListToggleRequest(value) {
	return isRecord$3(value) && safePath$1(value.path) && typeof value.source === "string" && stringBytes$1(value.source) <= 262144 && isPluginTaskListLocator(value.locator) && value.locator.path === value.path && typeof value.checked === "boolean";
}
function isPluginTaskListToggleResult(value) {
	if (!isRecord$3(value)) return false;
	if (value.status === "applied") return typeof value.source === "string" && stringBytes$1(value.source) <= 262144;
	return value.status === "conflict" && [
		"missing",
		"ambiguous",
		"changed"
	].includes(String(value.reason));
}
function isTaskListDate(value) {
	if (typeof value !== "string" || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = /* @__PURE__ */ new Date(`${value}T12:00:00Z`);
	return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function isPluginTaskListDocument(value) {
	return isRecord$3(value) && safePath$1(value.path) && safeSingleLine$1(value.title, 200) && typeof value.source === "string" && stringBytes$1(value.source) <= 262144;
}
function isPluginTaskListItem(value) {
	return isRecord$3(value) && safeSingleLine$1(value.id, 4096) && safePath$1(value.path) && safeSingleLine$1(value.noteTitle, 200) && positiveInteger(value.line) && safeDisplayText$1(value.text, 4096) && value.text.trim().length > 0 && typeof value.checked === "boolean" && isHeadingPath(value.headingPath) && Array.isArray(value.tags) && value.tags.length <= 32 && value.tags.every((tag) => safeSingleLine$1(tag, 80)) && new Set(value.tags).size === value.tags.length && (value.dueDate === null || isTaskListDate(value.dueDate)) && isPluginTaskListLocator(value.locator) && value.locator.path === value.path && value.locator.checked === value.checked;
}
function isPluginTaskListLocator(value) {
	return isRecord$3(value) && safePath$1(value.path) && typeof value.sourceLine === "string" && value.sourceLine.length > 0 && stringBytes$1(value.sourceLine) <= 8192 && SAFE_TEXT$1.test(value.sourceLine) && isHeadingPath(value.headingPath) && positiveInteger(value.occurrence) && positiveInteger(value.matchCount) && value.occurrence <= value.matchCount && typeof value.checked === "boolean";
}
function isHeadingPath(value) {
	return Array.isArray(value) && value.length <= 12 && value.every((heading) => safeSingleLine$1(heading, 200));
}
function isTimeZone(value) {
	if (typeof value !== "string" || value.length === 0 || value.length > 80) return false;
	try {
		new Intl.DateTimeFormat("en", { timeZone: value });
		return true;
	} catch (error) {
		if (error instanceof RangeError) return false;
		throw error;
	}
}
function safePath$1(value) {
	if (!safeDisplayText$1(value, 4096) || value.length === 0 || value.startsWith("/") || value.startsWith("\\") || value.includes("\\")) return false;
	return !value.split("/").some((segment) => !segment || segment === "." || segment === "..");
}
function safeSingleLine$1(value, maxLength) {
	return safeDisplayText$1(value, maxLength) && value.trim().length > 0 && !/[\r\n]/.test(value);
}
function safeDisplayText$1(value, maxLength) {
	return typeof value === "string" && value.length <= maxLength && SAFE_TEXT$1.test(value);
}
function positiveInteger(value) {
	return Number.isSafeInteger(value) && Number(value) > 0;
}
function nonNegativeInteger$1(value) {
	return Number.isSafeInteger(value) && Number(value) >= 0;
}
function stringBytes$1(value) {
	return new TextEncoder().encode(value).byteLength;
}
function isRecord$3(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
// src/noteGraph.ts
var MAX_PLUGIN_NOTE_GRAPH_DOCUMENTS = 5e3;
var MAX_PLUGIN_NOTE_GRAPH_SOURCE_BYTES = 262144;
var MAX_PLUGIN_NOTE_GRAPH_INDEX_BYTES = 524288;
var MAX_PLUGIN_NOTE_GRAPH_INDEX_DOCUMENTS = 256;
var MAX_PLUGIN_NOTE_GRAPH_INDEX_REMOVALS = 512;
var MAX_PLUGIN_NOTE_GRAPH_TOTAL_SOURCE_BYTES = 8388608;
var MAX_PLUGIN_NOTE_GRAPH_TAGS_PER_DOCUMENT = 32;
var MAX_PLUGIN_NOTE_GRAPH_NODES = 500;
var MAX_PLUGIN_NOTE_GRAPH_EDGES = 2e3;
var SAFE_TEXT = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]*$/u;
function isPluginNoteGraphRegistration(value) {
	return isRecord$2(value) && safeSingleLine(value.id, 160) && safeSingleLine(value.title, 160);
}
function isPluginNoteGraphIndexRequest(value) {
	if (!isRecord$2(value) || value.mode !== "replace" && value.mode !== "update" || !Array.isArray(value.documents) || value.documents.length > 256 || !Array.isArray(value.removedPaths) || value.removedPaths.length > 512 || !nonNegativeInteger(value.skippedCount) || typeof value.truncated !== "boolean") return false;
	const documentPaths = /* @__PURE__ */ new Set();
	let sourceBytes = 0;
	for (const document of value.documents) {
		if (!isPluginNoteGraphDocument(document) || documentPaths.has(document.path)) return false;
		documentPaths.add(document.path);
		sourceBytes += stringBytes(document.source);
		if (sourceBytes > 524288) return false;
	}
	const removedPaths = /* @__PURE__ */ new Set();
	for (const path of value.removedPaths) {
		if (!safePath(path) || documentPaths.has(path) || removedPaths.has(path)) return false;
		removedPaths.add(path);
	}
	return value.mode !== "replace" || removedPaths.size === 0;
}
function isPluginNoteGraphQuery(value) {
	return isRecord$2(value) && (value.scope === "global" || value.scope === "local") && (value.activePath === null || safePath(value.activePath)) && (value.folder === null || safeFolder(value.folder)) && (value.tag === null || safeSingleLine(value.tag, 80)) && [
		"all",
		"only",
		"connected"
	].includes(String(value.orphanFilter)) && (value.depth === 1 || value.depth === 2 || value.depth === 3);
}
function isPluginNoteGraphModel(value) {
	if (!isRecord$2(value) || !Array.isArray(value.nodes) || value.nodes.length > 500 || !Array.isArray(value.edges) || value.edges.length > 2e3 || !nonNegativeInteger(value.totalNotes) || !nonNegativeInteger(value.matchingNotes) || !nonNegativeInteger(value.totalEdges) || value.totalNotes < value.matchingNotes || value.matchingNotes < value.nodes.length || value.totalEdges < value.edges.length || !(value.activeNodeId === null || safeSingleLine(value.activeNodeId, 4096)) || typeof value.truncated !== "boolean" || !Array.isArray(value.notices) || value.notices.length > 16 || !value.notices.every((notice) => safeDisplayText(notice, 512))) return false;
	const nodes = /* @__PURE__ */ new Map();
	const paths = /* @__PURE__ */ new Set();
	for (const node of value.nodes) {
		if (!isPluginNoteGraphNode(node) || nodes.has(node.id) || paths.has(node.path)) return false;
		nodes.set(node.id, node);
		paths.add(node.path);
	}
	if (value.activeNodeId !== null && !nodes.has(value.activeNodeId)) return false;
	const edges = /* @__PURE__ */ new Set();
	for (const edge of value.edges) {
		const source = isRecord$2(edge) && typeof edge.sourceId === "string" ? nodes.get(edge.sourceId) : void 0;
		const target = isRecord$2(edge) && typeof edge.targetId === "string" ? nodes.get(edge.targetId) : void 0;
		if (!isRecord$2(edge) || !safeSingleLine(edge.sourceId, 4096) || !safeSingleLine(edge.targetId, 4096) || edge.sourceId === edge.targetId || !source || !target || source.outgoing === 0 || target.incoming === 0) return false;
		const key = `${edge.sourceId}\u0000${edge.targetId}`;
		if (edges.has(key)) return false;
		edges.add(key);
	}
	return true;
}
function isPluginNoteGraphDocument(value) {
	if (!isRecord$2(value) || !safePath(value.path) || !safeSingleLine(value.title, 200) || typeof value.source !== "string" || stringBytes(value.source) > 262144 || !Array.isArray(value.tags) || value.tags.length > 32) return false;
	const tags = /* @__PURE__ */ new Set();
	for (const tag of value.tags) {
		if (!safeSingleLine(tag, 80) || tags.has(tag)) return false;
		tags.add(tag);
	}
	return true;
}
function isPluginNoteGraphNode(value) {
	return isRecord$2(value) && safeSingleLine(value.id, 4096) && safePath(value.path) && safeSingleLine(value.title, 200) && Array.isArray(value.tags) && value.tags.length <= 32 && value.tags.every((tag) => safeSingleLine(tag, 80)) && new Set(value.tags).size === value.tags.length && nonNegativeInteger(value.incoming) && nonNegativeInteger(value.outgoing) && typeof value.orphan === "boolean" && value.orphan === (value.incoming === 0 && value.outgoing === 0) && (value.distance === null || nonNegativeInteger(value.distance) && value.distance <= 3);
}
function safePath(value) {
	if (!safeDisplayText(value, 4096) || value.length === 0 || value.startsWith("/") || value.startsWith("\\") || value.includes("\\")) return false;
	return !value.split("/").some((segment) => !segment || segment === "." || segment === "..");
}
function safeFolder(value) {
	if (!safeDisplayText(value, 4096) || value.startsWith("/") || value.startsWith("\\") || value.includes("\\")) return false;
	return value.length === 0 || !value.split("/").some((segment) => !segment || segment === "." || segment === "..");
}
function safeSingleLine(value, maxLength) {
	return safeDisplayText(value, maxLength) && value.trim().length > 0 && !/[\r\n]/.test(value);
}
function safeDisplayText(value, maxLength) {
	return typeof value === "string" && value.length <= maxLength && SAFE_TEXT.test(value);
}
function nonNegativeInteger(value) {
	return Number.isSafeInteger(value) && Number(value) >= 0;
}
function stringBytes(value) {
	return new TextEncoder().encode(value).byteLength;
}
function isRecord$2(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
// src/calendar.ts
var MAX_PLUGIN_CALENDAR_DAYS = 42;
var MAX_PLUGIN_CALENDAR_DOCUMENTS = 5e3;
var MAX_PLUGIN_CALENDAR_FRONTMATTER_BYTES = 8192;
var MAX_PLUGIN_CALENDAR_INPUT_BYTES = 2097152;
var MAX_PLUGIN_CALENDAR_NOTES = 1e3;
var MAX_PLUGIN_CALENDAR_NOTES_PER_DAY = 100;
var UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
function isCalendarDate(value) {
	if (typeof value !== "string" || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = /* @__PURE__ */ new Date(`${value}T12:00:00Z`);
	return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function calendarDates(startDate, endDate) {
	if (!isCalendarDate(startDate) || !isCalendarDate(endDate) || startDate > endDate) return [];
	const start = /* @__PURE__ */ new Date(`${startDate}T12:00:00Z`);
	const count = ((/* @__PURE__ */ new Date(`${endDate}T12:00:00Z`)).getTime() - start.getTime()) / 864e5 + 1;
	if (count > 42) return [];
	return Array.from({ length: count }, (_, index) => new Date(start.getTime() + index * 864e5).toISOString().slice(0, 10));
}
function isCalendarFolder(value) {
	return typeof value === "string" && value.length <= 1024 && (value === "" || value.split("/").every(isCalendarPathSegment));
}
function isCalendarNotePath(value) {
	return isCalendarFolder(value) && /\.(?:md|markdown)$/i.test(value);
}
function isCalendarPathSegment(value) {
	return value.length > 0 && new TextEncoder().encode(value).byteLength <= 255 && value.trim() === value && !value.endsWith(".") && !UNSAFE_TEXT.test(value) && !/[\\:*?"<>|]/.test(value) && ![
		".",
		"..",
		".denote",
		".git"
	].includes(value.toLowerCase()) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value);
}
function isPluginCalendarRegistration(value) {
	return isRecord$1(value) && safeLabel(value.id, 160) && safeLabel(value.title, 160) && (value.views === void 0 || Array.isArray(value.views) && value.views.length <= 3 && value.views.includes("dated") && value.views.every(isCalendarView) && new Set(value.views).size === value.views.length);
}
function isCalendarView(value) {
	return value === "dated" || value === "created" || value === "updated";
}
function isCalendarTimeZone(value) {
	if (typeof value !== "string" || value.length > 80) return false;
	try {
		new Intl.DateTimeFormat("en", { timeZone: value });
		return true;
	} catch (error) {
		if (error instanceof RangeError) return false;
		throw error;
	}
}
function isOptionalTimestamp(value) {
	return value === void 0 || value === null || typeof value === "number" && Number.isSafeInteger(value) && Math.abs(value) <= 864e13;
}
function calendarDocumentBytes(document) {
	return new TextEncoder().encode(JSON.stringify(document)).byteLength + 1;
}
function isPluginCalendarRequest(value) {
	if (!isRecord$1(value) || value.view !== void 0 && !isCalendarView(value.view) || value.timeZone !== void 0 && !isCalendarTimeZone(value.timeZone) || (value.view === "created" || value.view === "updated") && value.timeZone === void 0 || typeof value.startDate !== "string" || typeof value.endDate !== "string" || calendarDates(value.startDate, value.endDate).length === 0 || !Array.isArray(value.documents) || value.documents.length > 5e3 || !Number.isSafeInteger(value.skippedCount) || Number(value.skippedCount) < 0 || typeof value.truncated !== "boolean") return false;
	const paths = /* @__PURE__ */ new Set();
	let bytes = 0;
	for (const document of value.documents) {
		if (!isRecord$1(document) || !isCalendarNotePath(document.path) || paths.has(document.path) || !safeLabel(document.title, 200) || typeof document.frontmatter !== "string" || document.metadataAvailable !== void 0 && typeof document.metadataAvailable !== "boolean" || !isOptionalTimestamp(document.createdAt) || !isOptionalTimestamp(document.modifiedAt) || new TextEncoder().encode(document.frontmatter).byteLength > 8192) return false;
		paths.add(document.path);
		bytes += calendarDocumentBytes({
			path: document.path,
			title: document.title,
			frontmatter: document.frontmatter,
			metadataAvailable: document.metadataAvailable,
			createdAt: document.createdAt,
			modifiedAt: document.modifiedAt
		});
		if (bytes > 2097152) return false;
	}
	return true;
}
function isPluginCalendarModel(value, request) {
	if (!isRecord$1(value) || value.view !== void 0 && !isCalendarView(value.view) || request && (value.view ?? "dated") !== (request.view ?? "dated") || !Array.isArray(value.days) || value.days.length === 0 || value.days.length > 42 || typeof value.truncated !== "boolean" || !Array.isArray(value.notices) || value.notices.length > 16 || !value.notices.every((notice) => safeLabel(notice, 512))) return false;
	const first = value.days[0];
	const last = value.days[value.days.length - 1];
	if (!isRecord$1(first) || !isRecord$1(last) || !isCalendarDate(first.date) || !isCalendarDate(last.date)) return false;
	const dates = calendarDates(first.date, last.date);
	if (dates.length !== value.days.length || request && (first.date !== request.startDate || last.date !== request.endDate)) return false;
	const availablePaths = request ? new Set(request.documents.map(({ path }) => path)) : null;
	const dailyPaths = /* @__PURE__ */ new Set();
	const notePaths = /* @__PURE__ */ new Set();
	for (const [index, day] of value.days.entries()) {
		if (!isRecord$1(day) || day.date !== dates[index] || !isCalendarNotePath(day.dailyNotePath) || dailyPaths.has(day.dailyNotePath.toLowerCase()) || !Array.isArray(day.notes) || day.notes.length > 100) return false;
		dailyPaths.add(day.dailyNotePath.toLowerCase());
		for (const note of day.notes) {
			if (!isRecord$1(note) || !isCalendarNotePath(note.path) || !safeLabel(note.title, 200) || notePaths.has(note.path) || availablePaths && !availablePaths.has(note.path)) return false;
			notePaths.add(note.path);
			if (notePaths.size > 1e3) return false;
		}
	}
	return true;
}
function safeLabel(value, limit) {
	return typeof value === "string" && value.trim().length > 0 && value.length <= limit && !UNSAFE_TEXT.test(value);
}
function isRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
// src/diagramRenderer.ts
var MAX_PLUGIN_DIAGRAM_SOURCE_BYTES = 32768;
var MAX_PLUGIN_DIAGRAM_SOURCE_LINES = 1e3;
var MAX_PLUGIN_DIAGRAM_LINE_BYTES = 4096;
var MAX_PLUGIN_DIAGRAM_SVG_BYTES = 2097152;
var MAX_PLUGIN_DIAGRAM_ERROR_MESSAGE = 1024;
var MAX_PLUGIN_DIAGRAM_ACCESSIBLE_NAME = 80;
var MAX_PLUGIN_DIAGRAM_LANGUAGES = 8;
var encoder$1 = new TextEncoder();
function isPluginDiagramRendererRegistration(value) {
	if (!isRecord(value)) return false;
	if (typeof value.id !== "string" || value.id.length === 0 || value.id.length > 160 || typeof value.title !== "string" || value.title.trim().length === 0 || value.title.length > 120 || !Array.isArray(value.languages) || value.languages.length === 0 || value.languages.length > 8) return false;
	const languages = /* @__PURE__ */ new Set();
	for (const language of value.languages) {
		if (typeof language !== "string" || !/^[a-z][a-z0-9_-]{0,31}$/.test(language) || languages.has(language)) return false;
		languages.add(language);
	}
	return true;
}
function isPluginDiagramRenderResult(value) {
	if (!isRecord(value) || value.status !== "success" && value.status !== "error") return false;
	if (value.status === "success") return typeof value.svg === "string" && encoder$1.encode(value.svg).byteLength <= 2097152 && typeof value.diagramType === "string" && value.diagramType.length > 0 && value.diagramType.length <= 80 && typeof value.accessibleName === "string" && value.accessibleName.trim().length > 0 && value.accessibleName.length <= 80;
	if (!isRecord(value.error)) return false;
	return [
		"SOURCE_LIMIT",
		"UNSAFE_SOURCE",
		"UNSUPPORTED_DIAGRAM",
		"PARSE_ERROR",
		"RENDER_ERROR"
	].includes(String(value.error.code)) && typeof value.error.message === "string" && value.error.message.trim().length > 0 && value.error.message.length <= 1024 && optionalPositiveInteger(value.error.line) && optionalPositiveInteger(value.error.column);
}
function optionalPositiveInteger(value) {
	return value === void 0 || typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
// src/codeIntelligence.ts
var CODE_LANGUAGES = [
	"rust",
	"go",
	"python",
	"java",
	"cpp",
	"typescript"
];
var CODE_FEATURES = [
	"completion",
	"hover",
	"signature",
	"diagnostics",
	"format",
	"definition",
	"declaration",
	"implementation",
	"type-definition",
	"references",
	"symbols",
	"workspace-symbols"
];
var CODE_FEATURE_METHODS = {
	completion: "textDocument/completion",
	hover: "textDocument/hover",
	signature: "textDocument/signatureHelp",
	diagnostics: "textDocument/diagnostic",
	format: "textDocument/formatting",
	definition: "textDocument/definition",
	declaration: "textDocument/declaration",
	implementation: "textDocument/implementation",
	"type-definition": "textDocument/typeDefinition",
	references: "textDocument/references",
	symbols: "textDocument/documentSymbol",
	"workspace-symbols": "workspace/symbol"
};
var DEBUG_COMMANDS = [
	"launch",
	"attach",
	"setBreakpoints",
	"setExceptionBreakpoints",
	"continue",
	"pause",
	"next",
	"stepIn",
	"stepOut",
	"restart",
	"disconnect",
	"threads",
	"stackTrace",
	"scopes",
	"variables",
	"evaluate",
	"exceptionInfo"
];
var MAX_CODE_SOURCE_BYTES = 4194304;
var MAX_CODE_RESULTS = 500;
var MAX_CODE_LOGS = 200;
function codeDocumentUri(path) {
	if (!isCodePath(path, false)) throw new Error("Code document paths must stay inside the vault.");
	return `denote://vault/${path.split("/").map(encodeURIComponent).join("/")}`;
}
function codeLanguageForPath(path) {
	const parts = path.split(".");
	const extension = parts[parts.length - 1]?.toLowerCase();
	if (extension === "rs") return "rust";
	if (extension === "go") return "go";
	if (extension === "py" || extension === "pyi") return "python";
	if (extension === "java") return "java";
	if ([
		"c",
		"cc",
		"cpp",
		"cxx",
		"h",
		"hh",
		"hpp",
		"hxx"
	].includes(extension ?? "")) return "cpp";
	if ([
		"js",
		"jsx",
		"mjs",
		"cjs",
		"ts",
		"tsx",
		"mts",
		"cts"
	].includes(extension ?? "")) return "typescript";
	return null;
}
function isCodePath(value, allowRoot = true) {
	return typeof value === "string" && value.length <= 4096 && (allowRoot || value.length > 0) && !value.startsWith("/") && !value.includes("\\") && !value.includes(":") && !/[\u0000-\u001f\u007f]/.test(value) && (value === "" || value.split("/").every((part) => part !== "" && part !== "." && part !== ".." && part !== ".denote"));
}
function isCodePosition(value) {
	return record(value) && integer$1(value.line) && integer$1(value.character);
}
function isCodeRange(value) {
	return record(value) && isCodePosition(value.start) && isCodePosition(value.end) && (value.start.line < value.end.line || value.start.line === value.end.line && value.start.character <= value.end.character);
}
function isPluginCodeRequest(value) {
	if (!record(value) || !CODE_LANGUAGES.includes(value.language) || ![
		...CODE_FEATURES,
		"start",
		"stop",
		"restart",
		"poll",
		"open",
		"change",
		"save",
		"close",
		"debug"
	].includes(String(value.operation)) || !record(value.scope) || !(value.scope.projectId === null || text$2(value.scope.projectId, 128)) || !isCodePath(value.scope.rootPath)) return false;
	if (value.document !== void 0) {
		const doc = value.document;
		if (!record(doc) || !isCodePath(doc.path, false) || doc.language !== value.language || !integer$1(doc.version) || typeof doc.text !== "string" || new TextEncoder().encode(doc.text).length > 4194304 || value.scope.rootPath !== "" && !doc.path.startsWith(`${value.scope.rootPath}/`)) return false;
	}
	if ([
		"open",
		"change",
		"save",
		"close",
		...CODE_FEATURES.filter((feature) => feature !== "workspace-symbols")
	].includes(String(value.operation)) && value.document === void 0) return false;
	if (value.operation === "debug" && value.debug === void 0) return false;
	return (value.position === void 0 || isCodePosition(value.position)) && (value.query === void 0 || text$2(value.query, 1024, true)) && (value.debug === void 0 || record(value.debug) && DEBUG_COMMANDS.includes(value.debug.command) && (value.debug.arguments === void 0 || isCodeJson(value.debug.arguments)));
}
function isPluginCodeRegistration(value) {
	return record(value) && text$2(value.id, 128) && text$2(value.title, 128) && Array.isArray(value.languages) && value.languages.length > 0 && value.languages.length <= 6 && new Set(value.languages.map((language) => record(language) ? language.id : null)).size === value.languages.length && value.languages.every((language) => record(language) && CODE_LANGUAGES.some((id) => id === language.id) && text$2(language.title, 128) && text$2(language.server, 128) && text$2(language.debugger, 128) && text$2(language.setup, 4096));
}
function isCodeLocation(value) {
	return record(value) && isCodePath(value.path, false) && isCodeRange(value.range) && optional(value.name, (item) => text$2(item, 1024)) && optional(value.container, (item) => text$2(item, 1024, true)) && optional(value.project, (item) => text$2(item, 4096, true)) && optional(value.language, (item) => CODE_LANGUAGES.some((id) => id === item));
}
function isCodeEdit(value) {
	return record(value) && isCodeRange(value.range) && text$2(value.text, 4194304, true);
}
function isPluginCodeResult(value) {
	if (!record(value) || !text$2(value.status, 4096, true) || !isCodeJson(value)) return false;
	return optional(value.capabilities, (item) => array(item, 12, (feature) => CODE_FEATURES.some((id) => id === feature))) && optional(value.locations, (item) => array(item, 500, isCodeLocation)) && optional(value.completions, (item) => array(item, 500, (completion) => isCodeEdit(completion) && record(completion) && text$2(completion.label, 1024) && optional(completion.detail, (detail) => text$2(detail, 4096, true)))) && optional(value.hover, (item) => text$2(item, 32768, true)) && optional(value.signatures, (item) => array(item, 32, (label) => text$2(label, 4096))) && optional(value.diagnostics, (item) => array(item, 500, (diagnostic) => record(diagnostic) && isCodeRange(diagnostic.range) && text$2(diagnostic.message, 8192) && [
		"error",
		"warning",
		"info",
		"hint"
	].includes(String(diagnostic.severity)) && optional(diagnostic.source, (source) => text$2(source, 128)))) && optional(value.edits, (item) => array(item, 500, isCodeEdit)) && optional(value.logs, (item) => array(item, 200, (log) => text$2(log, 8192, true))) && optional(value.notices, (item) => array(item, 32, (notice) => text$2(notice, 4096))) && optional(value.debug, isDebugModel);
}
function isDebugModel(value) {
	return record(value) && [
		"starting",
		"running",
		"stopped",
		"terminated"
	].includes(String(value.state)) && optional(value.stopEpoch, integer$1) && array(value.capabilities, 64, (item) => text$2(item, 128)) && array(value.threads, 500, (item) => record(item) && integer$1(item.id) && text$2(item.name, 1024)) && array(value.frames, 500, (item) => record(item) && integer$1(item.id) && text$2(item.name, 1024) && optional(item.location, isCodeLocation)) && array(value.scopes, 500, (item) => record(item) && text$2(item.name, 1024) && integer$1(item.variablesReference)) && array(value.variables, 500, (item) => record(item) && text$2(item.name, 1024) && text$2(item.value, 8192, true) && integer$1(item.variablesReference) && optional(item.type, (type) => text$2(type, 128))) && array(value.breakpoints, 500, (item) => record(item) && integer$1(item.line) && typeof item.verified === "boolean" && optional(item.message, (message) => text$2(message, 4096))) && array(value.output, 200, (item) => text$2(item, 8192, true)) && optional(value.exception, (item) => text$2(item, 8192)) && optional(value.watches, (item) => array(item, 20, (watch) => record(watch) && text$2(watch.expression, 1024) && text$2(watch.value, 8192, true) && integer$1(watch.variablesReference) && optional(watch.type, (type) => text$2(type, 128))));
}
function optional(value, check) {
	return value === void 0 || check(value);
}
function array(value, maximum, check) {
	return Array.isArray(value) && value.length <= maximum && value.every(check);
}
function record(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function integer$1(value) {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 2147483647;
}
function text$2(value, maximum, empty = false) {
	return typeof value === "string" && (empty || value.length > 0) && value.length <= maximum;
}
function isCodeJson(value) {
	let remaining = 2e4;
	const visit = (item, depth) => {
		if (--remaining < 0 || depth > 20) return false;
		if (item === null || typeof item === "boolean") return true;
		if (typeof item === "number") return Number.isFinite(item);
		if (typeof item === "string") return item.length <= MAX_CODE_SOURCE_BYTES;
		if (Array.isArray(item)) return item.length <= 5e3 && item.every((child) => visit(child, depth + 1));
		return record(item) && Object.entries(item).every(([key, child]) => key.length <= 256 && visit(child, depth + 1));
	};
	return visit(value, 0) && JSON.stringify(value).length <= 4194304;
}
// src/civilTime.ts
var FORMATTERS = /* @__PURE__ */ new Map();
function resolveReminderSchedule(schedule) {
	return schedule.kind === "instant" ? schedule.dueAt : resolveWallClock(schedule.localDateTime, schedule.timeZone);
}
function resolveWallClock(localDateTime, timeZone) {
	if (!isReminderLocalDateTime(localDateTime) || !isReminderTimeZone(timeZone)) throw new Error("The date, time, or time zone is invalid.");
	const [date, time] = localDateTime.split("T");
	const [year, month, day] = date.split("-").map(Number);
	const [hour, minute] = time.split(":").map(Number);
	const naive = Date.UTC(year, month - 1, day, hour, minute);
	const offsets = /* @__PURE__ */ new Set();
	for (const hours of [
		-36,
		-24,
		-12,
		0,
		12,
		24,
		36
	]) {
		const instant = naive + hours * 36e5;
		offsets.add(partsAsUtc(zonedParts(instant, timeZone)) - instant);
	}
	const candidates = [...offsets].map((offset) => naive - offset).filter((instant) => {
		const actual = zonedParts(instant, timeZone);
		return actual.year === year && actual.month === month && actual.day === day && actual.hour === hour && actual.minute === minute && actual.second === 0;
	}).sort((a, b) => a - b);
	if (candidates[0] === void 0) throw new Error(`The local time ${localDateTime} does not exist in ${timeZone} because of a daylight-saving transition.`);
	return candidates[0];
}
function nextRecurringSchedule(schedule, recurrence, after) {
	if (recurrence.unit === "minute" || recurrence.unit === "hour") {
		const base = resolveReminderSchedule(schedule);
		const interval = recurrence.interval * (recurrence.unit === "minute" ? 6e4 : 36e5);
		return {
			kind: "instant",
			dueAt: base + (Math.floor(Math.max(0, after - base) / interval) + 1) * interval,
			timeZone: schedule.timeZone
		};
	}
	let localDateTime = schedule.kind === "wall-clock" ? schedule.localDateTime : civilDateTimeAt(schedule.dueAt, schedule.timeZone);
	for (let iteration = 0; iteration < 1e4; iteration += 1) {
		localDateTime = addRecurrence(localDateTime, recurrence);
		const next = {
			kind: "wall-clock",
			localDateTime,
			timeZone: schedule.timeZone
		};
		try {
			if (resolveReminderSchedule(next) > after) return next;
		} catch (error) {
			if (!(error instanceof Error) || !error.message.includes("does not exist")) throw error;
		}
	}
	throw new Error("The recurring schedule could not reach a future date.");
}
function addRecurrence(localDateTime, recurrence) {
	if (!isReminderLocalDateTime(localDateTime) || !Number.isInteger(recurrence.interval) || recurrence.interval < 1 || recurrence.interval > 999) throw new Error("The recurring date or interval is invalid.");
	const [datePart, timePart] = localDateTime.split("T");
	const [year, month, day] = datePart.split("-").map(Number);
	const [hour, minute] = timePart.split(":").map(Number);
	const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
	switch (recurrence.unit) {
		case "minute":
			date.setUTCMinutes(minute + recurrence.interval);
			break;
		case "hour":
			date.setUTCHours(hour + recurrence.interval);
			break;
		case "day":
			date.setUTCDate(day + recurrence.interval);
			break;
		case "week":
			date.setUTCDate(day + recurrence.interval * 7);
			break;
		case "month":
			date.setUTCDate(1);
			date.setUTCMonth(month - 1 + recurrence.interval);
			date.setUTCDate(Math.min(day, daysInMonth(date.getUTCFullYear(), date.getUTCMonth() + 1)));
			break;
		case "year":
			date.setUTCDate(1);
			date.setUTCFullYear(year + recurrence.interval);
			date.setUTCDate(Math.min(day, daysInMonth(date.getUTCFullYear(), month)));
	}
	return `${String(date.getUTCFullYear()).padStart(4, "0")}-${two(date.getUTCMonth() + 1)}-${two(date.getUTCDate())}T${two(date.getUTCHours())}:${two(date.getUTCMinutes())}`;
}
function civilDateTimeAt(instant, timeZone) {
	const parts = zonedParts(instant, timeZone);
	return `${String(parts.year).padStart(4, "0")}-${two(parts.month)}-${two(parts.day)}T${two(parts.hour)}:${two(parts.minute)}`;
}
function two(value) {
	return String(value).padStart(2, "0");
}
function daysInMonth(year, month) {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
function zonedParts(instant, timeZone) {
	let format = FORMATTERS.get(timeZone);
	if (!format) {
		format = new Intl.DateTimeFormat("en-CA", {
			timeZone,
			calendar: "gregory",
			numberingSystem: "latn",
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hourCycle: "h23"
		});
		if (FORMATTERS.size >= 64) {
			const oldest = FORMATTERS.keys().next().value;
			if (oldest !== void 0) FORMATTERS.delete(oldest);
		}
		FORMATTERS.set(timeZone, format);
	}
	const parts = new Map(format.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
	return {
		year: Number(parts.get("year")),
		month: Number(parts.get("month")),
		day: Number(parts.get("day")),
		hour: Number(parts.get("hour")),
		minute: Number(parts.get("minute")),
		second: Number(parts.get("second"))
	};
}
function partsAsUtc(parts) {
	return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}
// src/authoring.ts
var AUTHORING_FEATURES = [
	"text-styling",
	"note-comments",
	"presentation"
];
var AUTHORING_COLORS = [
	"yellow",
	"red",
	"green",
	"blue",
	"purple"
];
var MAX_AUTHORING_SOURCE_BYTES = 4194304;
var MAX_NOTE_COMMENTS = 500;
var MAX_PRESENTATION_SLIDES = 256;
var encoder = new TextEncoder();
var COLORS = AUTHORING_COLORS;
var FEATURES = AUTHORING_FEATURES;
function isPluginAuthoringRegistration(value) {
	return record$1(value) && singleLine(value.id, 160) && singleLine(value.title, 160) && typeof value.feature === "string" && FEATURES.includes(value.feature);
}
function isPluginCommentAnchor(value) {
	return record$1(value) && position(value.from) && position(value.to) && value.to > value.from && text$1(value.quote, 4096) && value.quote.length > 0 && value.to - value.from === value.quote.length && text$1(value.prefix, 96) && text$1(value.suffix, 96) && position(value.matchCount) && value.matchCount > 0;
}
function isPluginAuthoringRequest(value) {
	if (!record$1(value) || !text$1(value.source, 4194304)) return false;
	const fields = value.feature === "text-styling" && value.action === "format" ? [
		"from",
		"to",
		"style",
		"color"
	] : value.feature === "note-comments" && value.action === "anchor" ? ["from", "to"] : value.feature === "note-comments" && value.action === "locate" ? ["anchors"] : value.feature === "presentation" && value.action === "reorder" ? ["order"] : [];
	const allowed = /* @__PURE__ */ new Set([
		"feature",
		"action",
		"source",
		...fields
	]);
	if (Object.keys(value).some((key) => !allowed.has(key))) return false;
	if (value.feature === "text-styling") return value.action === "parse" || value.action === "format" && range(value, value.source.length) && value.from !== value.to && [
		"highlight",
		"color",
		"clear"
	].includes(String(value.style)) && COLORS.includes(String(value.color));
	if (value.feature === "note-comments") {
		if (value.action === "anchor") return range(value, value.source.length) && text$1(value.source.slice(value.from, value.to), 4096);
		return value.action === "locate" && Array.isArray(value.anchors) && value.anchors.length <= 500 && uniqueIds(value.anchors) && value.anchors.every((item) => record$1(item) && singleLine(item.id, 80) && (item.anchor === null || isPluginCommentAnchor(item.anchor)));
	}
	if (value.feature === "presentation") {
		const order = value.order;
		return value.action === "parse" || value.action === "reorder" && Array.isArray(value.order) && Array.isArray(order) && order.length > 0 && order.length <= 256 && order.every(position) && new Set(order).size === order.length && order.every((index) => index < order.length);
	}
	return false;
}
function isPluginAuthoringResult(value) {
	if (!record$1(value)) return false;
	if (value.feature === "text-styling") {
		if (value.action === "format") return sourceEdit(value.edit);
		return value.action === "parse" && Array.isArray(value.spans) && value.spans.length <= 2e3 && notices(value.notices) && value.spans.every((span) => record$1(span) && position(span.from) && position(span.to) && span.to > span.from && text$1(span.text, 4096) && span.text.length > 0 && ["highlight", "color"].includes(String(span.style)) && COLORS.includes(String(span.color)));
	}
	if (value.feature === "note-comments") {
		if (value.action === "anchor") return value.anchor === null || isPluginCommentAnchor(value.anchor);
		return value.action === "locate" && Array.isArray(value.anchors) && value.anchors.length <= 500 && uniqueIds(value.anchors) && value.anchors.every((item) => record$1(item) && singleLine(item.id, 80) && (item.status === "attached" && position(item.from) && position(item.to) && item.to >= item.from || ["missing", "ambiguous"].includes(String(item.status)) && item.from === null && item.to === null));
	}
	return value.feature === "presentation" && presentationModel(value.model) && (value.action === "parse" || value.action === "reorder" && sourceEdit(value.edit));
}
function isPluginAuthoringResultFor(request, value) {
	if (!isPluginAuthoringRequest(request) || !isPluginAuthoringResult(value) || value.feature !== request.feature || value.action !== request.action) return false;
	if (request.feature === "text-styling" && request.action === "format" && value.feature === "text-styling" && value.action === "format") {
		const selected = request.source.slice(request.from, request.to);
		const delimiter = textStyleDelimiter(request.style === "color" ? "color" : "highlight", request.color);
		const cleared = /^(=(?:yellow|red|green|blue|purple)(?::text)?=)([\s\S]+)\1$/.exec(selected);
		const expected = request.style === "clear" ? cleared?.[2] : delimiter + selected + delimiter;
		return expected !== void 0 && value.edit.from === request.from && value.edit.to === request.to && value.edit.text === expected;
	}
	if (request.feature === "text-styling" && request.action === "parse" && value.feature === "text-styling" && value.action === "parse") {
		let end = 0;
		return value.spans.every((span) => {
			const delimiter = textStyleDelimiter(span.style, span.color);
			const valid = span.from >= end && span.to <= request.source.length && request.source.slice(span.from, span.to) === delimiter + span.text + delimiter;
			end = span.to;
			return valid;
		});
	}
	if (request.feature === "note-comments" && request.action === "anchor" && value.feature === "note-comments" && value.action === "anchor") return request.from === request.to ? value.anchor === null : value.anchor !== null && value.anchor.from === request.from && value.anchor.to === request.to && anchorMatchesSource(request.source, value.anchor);
	if (request.feature === "note-comments" && request.action === "locate" && value.feature === "note-comments" && value.action === "locate") return value.anchors.length === request.anchors.length && value.anchors.every((located, index) => {
		const original = request.anchors[index];
		if (located.id !== original.id) return false;
		if (located.status !== "attached") return original.anchor !== null;
		if (original.anchor === null) return located.from === 0 && located.to === 0;
		const matches = commentAnchorMatches(request.source, original.anchor);
		return matches.length === 1 && located.from === matches[0] && located.to === matches[0] + original.anchor.quote.length;
	});
	if (request.feature === "presentation" && value.feature === "presentation") {
		if (!presentationModelMatchesSource(request.source, value.model)) return false;
		if (request.action === "reorder" && value.action === "reorder") return request.order.length === value.model.slides.length && value.edit.from === value.model.bodyStart && value.edit.to === request.source.length && value.edit.text === reorderedPresentationBody(request.source, value.model, request.order);
		return request.action === "parse" && value.action === "parse";
	}
	return false;
}
function verifiedAuthoringEdit(request, result) {
	if (!isPluginAuthoringResultFor(request, result) || !("edit" in result)) throw new Error("The plugin returned an unsafe or stale source edit. Nothing was changed.");
	return request.source.slice(0, result.edit.from) + result.edit.text + request.source.slice(result.edit.to);
}
function textStyleDelimiter(style, color) {
	return `=${color}${style === "color" ? ":text" : ""}=`;
}
/** Both trust boundaries use the same fail-closed, exact-quote identity rule. */
function commentAnchorMatches(source, anchor) {
	const matches = [];
	let offset = source.indexOf(anchor.quote);
	while (offset >= 0) {
		matches.push(offset);
		if (matches.length > anchor.matchCount) return [];
		offset = source.indexOf(anchor.quote, offset + 1);
	}
	if (matches.length !== anchor.matchCount) return [];
	if (matches.length === 1) return matches;
	return matches.filter((from) => source.slice(Math.max(0, from - anchor.prefix.length), from) === anchor.prefix && source.slice(from + anchor.quote.length, from + anchor.quote.length + anchor.suffix.length) === anchor.suffix);
}
function reorderedPresentationBody(source, model, order) {
	const newline = source.includes("\r\n") ? "\r\n" : source.includes("\r") ? "\r" : "\n";
	return order.map((index, position) => {
		const slide = model.slides[index];
		const separator = model.separators[position];
		let body = source.slice(slide.from, slide.to);
		if (separator) {
			if (body && !/[\r\n]$/.test(body)) body += newline;
			const delimiter = source.slice(separator.from, separator.to);
			if (!body && position === 0 && model.bodyStart === 0 && delimiter.startsWith("---")) body = newline;
			body += delimiter + (/[\r\n]$/.test(delimiter) ? "" : newline);
		}
		return body;
	}).join("");
}
function anchorMatchesSource(source, anchor) {
	if (source.slice(anchor.from, anchor.to) !== anchor.quote || source.slice(Math.max(0, anchor.from - anchor.prefix.length), anchor.from) !== anchor.prefix || source.slice(anchor.to, anchor.to + anchor.suffix.length) !== anchor.suffix) return false;
	let count = 0;
	for (let at = source.indexOf(anchor.quote); at >= 0; at = source.indexOf(anchor.quote, at + 1)) count++;
	return count === anchor.matchCount;
}
function presentationModelMatchesSource(source, model) {
	let cursor = model.bodyStart;
	if (cursor > source.length || model.separators.length !== model.slides.length - 1) return false;
	return model.slides.every((slide, index) => {
		if (slide.from !== cursor || slide.to > source.length || slide.to < slide.from) return false;
		cursor = slide.to;
		const separator = model.separators[index];
		if (!separator) return cursor === source.length;
		if (separator.from !== cursor || separator.to > source.length || !/^(?:---|===)(?:\r\n|\n|\r)?$/.test(source.slice(separator.from, separator.to)) || separator.from > 0 && !/[\r\n]/.test(source[separator.from - 1])) return false;
		cursor = separator.to;
		return true;
	});
}
function presentationModel(value) {
	if (!record$1(value) || !position(value.bodyStart) || !Array.isArray(value.slides) || !value.slides.length || value.slides.length > 256 || !value.slides.every((slide) => record$1(slide) && position(slide.from) && position(slide.to) && position(slide.line) && slide.line > 0 && singleLine(slide.title, 200)) || !Array.isArray(value.separators) || !value.separators.every((item) => record$1(item) && position(item.from) && position(item.to)) || !notices(value.notices) || !record$1(value.options)) return false;
	const options = value.options;
	return text$1(options.title, 200) && text$1(options.author, 200) && [
		"system",
		"light",
		"dark"
	].includes(String(options.theme)) && [
		"16:9",
		"4:3",
		"16:10"
	].includes(String(options.aspectRatio)) && [
		"left",
		"center",
		"right"
	].includes(String(options.alignment)) && typeof options.slideNumbers === "boolean" && typeof options.autoplay === "boolean" && typeof options.loop === "boolean" && ["none", "fade"].includes(String(options.transition)) && typeof options.advanceSeconds === "number" && Number.isFinite(options.advanceSeconds) && options.advanceSeconds >= 1 && options.advanceSeconds <= 3600;
}
function record$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text$1(value, max) {
	return typeof value === "string" && value.length <= max && encoder.encode(value).length <= max && !/[\u0000\u202a-\u202e\u2066-\u2069]/u.test(value);
}
function singleLine(value, max) {
	return text$1(value, max) && value.trim().length > 0 && !/[\r\n\u0000-\u001f\u007f]/.test(value);
}
function position(value) {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function range(value, length) {
	return position(value.from) && position(value.to) && value.to >= value.from && value.to <= length;
}
function sourceEdit(value) {
	return record$1(value) && position(value.from) && position(value.to) && value.to >= value.from && text$1(value.text, 4194304);
}
function notices(value) {
	return Array.isArray(value) && value.length <= 32 && value.every((item) => singleLine(item, 512));
}
function uniqueIds(value) {
	return new Set(value.map((item) => record$1(item) ? item.id : void 0)).size === value.length;
}
// src/sensitiveTools.ts
var SENSITIVE_TOOL_FEATURES = ["speech", "credential-store"];
function isPluginSensitiveToolRegistration(value) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const tool = value;
	return Object.keys(tool).every((key) => [
		"id",
		"title",
		"feature",
		"type"
	].includes(key)) && (tool.type === void 0 || tool.type === "register-sensitive-tool") && typeof tool.id === "string" && /^[a-z0-9][a-z0-9.-]{0,159}$/.test(tool.id) && typeof tool.title === "string" && tool.title.trim().length > 0 && tool.title.length <= 160 && !/[\u0000-\u001f\u007f]/.test(tool.title) && SENSITIVE_TOOL_FEATURES.some((feature) => feature === tool.feature);
}
// src/tooling.ts
var TOOL_FORMATS = [
	"unix",
	"msvc",
	"eslint-json",
	"cargo-json"
];
var MAX_TOOL_OUTPUT_BYTES = 8388608;
var MAX_TOOL_DIAGNOSTICS = 1e3;
function text(value, maximum) {
	return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(value);
}
function integer(value) {
	return Number.isSafeInteger(value) && Number(value) >= 0;
}
function isToolRegistration(value) {
	return record(value) && text(value.id, 128) && text(value.title, 128) && Object.keys(value).every((key) => [
		"type",
		"id",
		"title",
		"kind",
		"formats",
		"parse"
	].includes(key)) && [
		"linter",
		"build",
		"terminal"
	].includes(String(value.kind)) && Array.isArray(value.formats) && value.formats.length <= TOOL_FORMATS.length && new Set(value.formats).size === value.formats.length && (value.kind === "terminal" ? value.formats.length === 0 : value.formats.length > 0) && value.formats.every((format) => TOOL_FORMATS.some((entry) => entry === format));
}
function isToolParseRequest(value) {
	if (!record(value) || !text(value.runId, 128) || !record(value.scope) || !(value.scope.projectId === null || text(value.scope.projectId, 128)) || !isCodePath(value.scope.rootPath) || !TOOL_FORMATS.some((format) => format === value.format) || typeof value.stdout !== "string" || typeof value.stderr !== "string" || new TextEncoder().encode(value.stdout + value.stderr).length > 8388608 || !Array.isArray(value.documents) || value.documents.length > 5e3) return false;
	const root = value.scope.rootPath;
	return new Set(value.documents.map((document) => record(document) ? document.path : null)).size === value.documents.length && value.documents.every((document) => record(document) && isCodePath(document.path, false) && !document.path.split("/").includes(".git") && text(document.version, 128) && (root === "" || document.path.startsWith(`${root}/`)));
}
function isToolParseResult(value) {
	let inserted = 0;
	return record(value) && Object.keys(value).every((key) => [
		"runId",
		"diagnostics",
		"notices"
	].includes(key)) && text(value.runId, 128) && Array.isArray(value.diagnostics) && value.diagnostics.length <= 1e3 && value.diagnostics.every((diagnostic) => {
		if (!record(diagnostic) || !isCodePath(diagnostic.path, false) || diagnostic.path.split("/").includes(".git") || !text(diagnostic.version, 128) || !isCodeRange(diagnostic.range) || !text(diagnostic.message, 8192) || ![
			"error",
			"warning",
			"info",
			"hint"
		].includes(String(diagnostic.severity)) || diagnostic.rule !== void 0 && !text(diagnostic.rule, 256)) return false;
		const fix = diagnostic.fix;
		if (fix === void 0) return true;
		if (!record(fix) || !integer(fix.from) || !integer(fix.to) || fix.from > fix.to || typeof fix.text !== "string") return false;
		inserted += fix.text.length;
		return inserted <= 4194304;
	}) && Array.isArray(value.notices) && value.notices.length <= 20 && value.notices.every((notice) => text(notice, 1024));
}
function isToolParseResultFor(request, result) {
	if (!isToolParseRequest(request) || !isToolParseResult(result) || result.runId !== request.runId) return false;
	const versions = new Map(request.documents.map((document) => [document.path, document.version]));
	return result.diagnostics.every((diagnostic) => versions.get(diagnostic.path) === diagnostic.version);
}
function parseToolDiagnostics(request) {
	if (!isToolParseRequest(request)) throw new Error("Invalid diagnostic input or output limit exceeded.");
	const diagnostics = [];
	const versions = new Map(request.documents.map((document) => [document.path, document.version]));
	let omitted = 0;
	const add = (path, line, column, severity, message, rule, fix) => {
		path = path.replace(/\\/g, "/").replace(/^\.\//, "");
		const root = request.scope.rootPath;
		if (!versions.has(path) && root) path = `${root}/${path}`;
		const version = versions.get(path);
		if (!version || !isCodePath(path, false) || !Number.isSafeInteger(line) || line < 1 || !Number.isSafeInteger(column) || column < 1 || diagnostics.length >= 1e3) {
			omitted += 1;
			return;
		}
		const position = {
			line: line - 1,
			character: column - 1
		};
		diagnostics.push({
			path,
			version,
			range: {
				start: position,
				end: position
			},
			severity,
			message,
			...rule ? { rule } : {},
			...fix ? { fix } : {}
		});
	};
	if (request.format === "eslint-json") {
		const files = JSON.parse(request.stdout || "[]");
		if (!Array.isArray(files)) throw new Error("ESLint JSON must be an array of file results.");
		for (const file of files) {
			if (!record(file) || typeof file.filePath !== "string" || !Array.isArray(file.messages)) throw new Error("Invalid ESLint JSON file result.");
			for (const message of file.messages) {
				if (!record(message) || typeof message.message !== "string" || message.severity !== 1 && message.severity !== 2) throw new Error("Invalid ESLint JSON message.");
				const proposal = message.fix;
				let fix;
				if (proposal !== void 0) {
					if (!record(proposal) || !Array.isArray(proposal.range) || proposal.range.length !== 2 || !integer(proposal.range[0]) || !integer(proposal.range[1]) || proposal.range[0] > proposal.range[1] || typeof proposal.text !== "string") throw new Error("Invalid ESLint JSON fix proposal.");
					fix = {
						from: proposal.range[0],
						to: proposal.range[1],
						text: proposal.text
					};
				}
				add(file.filePath, Number(message.line ?? 1), Number(message.column ?? 1), message.severity === 2 ? "error" : "warning", message.message, typeof message.ruleId === "string" ? message.ruleId : void 0, fix);
			}
		}
	} else for (const raw of `${request.stdout}\n${request.stderr}`.split("\n")) {
		const line = raw.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").trimEnd();
		if (request.format === "cargo-json") {
			if (!line.startsWith("{")) continue;
			const event = JSON.parse(line);
			const message = record(event) && record(event.message) ? event.message : event;
			if (!record(message) || typeof message.message !== "string" || !Array.isArray(message.spans)) continue;
			for (const span of message.spans) {
				if (!record(span) || span.is_primary !== true || typeof span.file_name !== "string") continue;
				add(span.file_name, Number(span.line_start), Number(span.column_start), message.level === "warning" ? "warning" : message.level === "note" || message.level === "help" ? "info" : "error", message.message, record(message.code) && typeof message.code.code === "string" ? message.code.code : void 0);
			}
		} else if (request.format === "msvc") {
			const match = /^(.*?)\((\d+)(?:,(\d+))?\)\s*:\s*(error|warning|fatal error)\s+([^:]+):\s*(.+)$/.exec(line.replace(/^\d+>/, ""));
			if (match) add(match[1], Number(match[2]), Number(match[3] ?? 1), match[4] === "warning" ? "warning" : "error", match[6], match[5]);
		} else {
			const match = /^(.*?):(\d+):(?:(\d+):)?\s*(error|warning|info|note|fatal error):\s*(.*?)(?:\s+\[([^\]]+)\])?$/.exec(line);
			if (match) add(match[1], Number(match[2]), Number(match[3] ?? 1), match[4] === "warning" ? "warning" : match[4] === "info" || match[4] === "note" ? "info" : "error", match[5], match[6]);
		}
	}
	const result = {
		runId: request.runId,
		diagnostics,
		notices: omitted ? [`${omitted} diagnostics omitted because their files, positions, or result count are outside this run's snapshot.`] : []
	};
	if (!isToolParseResultFor(request, result)) throw new Error("The tool returned invalid diagnostics.");
	return result;
}
export { AUTHORING_COLORS, AUTHORING_FEATURES, CLOCKS_STOP_KEY, CLOCK_CONTENT_CAPABILITIES, CODE_FEATURES, CODE_FEATURE_METHODS, CODE_LANGUAGES, DEBUG_COMMANDS, EMOJI_MAX_ENTRIES, EMOJI_MAX_FAVORITES, EMOJI_MAX_RECENTS, MAX_AUTHORING_SOURCE_BYTES, MAX_CODE_LOGS, MAX_CODE_RESULTS, MAX_CODE_SOURCE_BYTES, MAX_NOTE_COMMENTS, MAX_PLUGIN_ALARMS, MAX_PLUGIN_CALENDAR_DAYS, MAX_PLUGIN_CALENDAR_DOCUMENTS, MAX_PLUGIN_CALENDAR_FRONTMATTER_BYTES, MAX_PLUGIN_CALENDAR_INPUT_BYTES, MAX_PLUGIN_CALENDAR_NOTES, MAX_PLUGIN_CALENDAR_NOTES_PER_DAY, MAX_PLUGIN_COUNTDOWNS, MAX_PLUGIN_COUNTDOWN_MS, MAX_PLUGIN_DIAGRAM_ACCESSIBLE_NAME, MAX_PLUGIN_DIAGRAM_ERROR_MESSAGE, MAX_PLUGIN_DIAGRAM_LANGUAGES, MAX_PLUGIN_DIAGRAM_LINE_BYTES, MAX_PLUGIN_DIAGRAM_SOURCE_BYTES, MAX_PLUGIN_DIAGRAM_SOURCE_LINES, MAX_PLUGIN_DIAGRAM_SVG_BYTES, MAX_PLUGIN_KANBAN_CARDS, MAX_PLUGIN_KANBAN_CARD_BODY_BYTES, MAX_PLUGIN_KANBAN_COLUMNS, MAX_PLUGIN_KANBAN_FILE_SUFFIXES, MAX_PLUGIN_KANBAN_LINKS_PER_CARD, MAX_PLUGIN_KANBAN_MODEL_BYTES, MAX_PLUGIN_KANBAN_SOURCE_BYTES, MAX_PLUGIN_KANBAN_TAGS_PER_CARD, MAX_PLUGIN_NOTE_GRAPH_DOCUMENTS, MAX_PLUGIN_NOTE_GRAPH_EDGES, MAX_PLUGIN_NOTE_GRAPH_INDEX_BYTES, MAX_PLUGIN_NOTE_GRAPH_INDEX_DOCUMENTS, MAX_PLUGIN_NOTE_GRAPH_INDEX_REMOVALS, MAX_PLUGIN_NOTE_GRAPH_NODES, MAX_PLUGIN_NOTE_GRAPH_SOURCE_BYTES, MAX_PLUGIN_NOTE_GRAPH_TAGS_PER_DOCUMENT, MAX_PLUGIN_NOTE_GRAPH_TOTAL_SOURCE_BYTES, MAX_PLUGIN_REMINDERS, MAX_PLUGIN_REMINDER_DELIVERY_ATTEMPTS, MAX_PLUGIN_REMINDER_DOCUMENT_BYTES, MAX_PLUGIN_REMINDER_ERROR_BYTES, MAX_PLUGIN_REMINDER_NOTIFICATION_BODY_BYTES, MAX_PLUGIN_REMINDER_NOTIFICATION_TITLE_BYTES, MAX_PLUGIN_REMINDER_RECURRENCE_INTERVAL, MAX_PLUGIN_REMINDER_TARGETS, MAX_PLUGIN_REMINDER_TITLE_BYTES, MAX_PLUGIN_STRUCTURED_VIEWER_EXTENSIONS, MAX_PLUGIN_STRUCTURED_VIEWER_MODEL_BYTES, MAX_PLUGIN_STRUCTURED_VIEWER_NODES, MAX_PLUGIN_STRUCTURED_VIEWER_SOURCE_BYTES, MAX_PLUGIN_TASK_LIST_DOCUMENTS, MAX_PLUGIN_TASK_LIST_HEADING_DEPTH, MAX_PLUGIN_TASK_LIST_INDEX_BYTES, MAX_PLUGIN_TASK_LIST_INDEX_DOCUMENTS, MAX_PLUGIN_TASK_LIST_INDEX_REMOVALS, MAX_PLUGIN_TASK_LIST_SOURCE_BYTES, MAX_PLUGIN_TASK_LIST_SOURCE_LINE_BYTES, MAX_PLUGIN_TASK_LIST_TAGS, MAX_PLUGIN_TASK_LIST_TAGS_PER_TASK, MAX_PLUGIN_TASK_LIST_TASKS, MAX_PLUGIN_TASK_LIST_TOTAL_SOURCE_BYTES, MAX_PRESENTATION_SLIDES, MAX_TIME_TRACKING_HISTORY, MAX_TIME_TRACKING_SEGMENTS, MAX_TIME_TRACKING_SESSIONS, MAX_TOOL_DIAGNOSTICS, MAX_TOOL_OUTPUT_BYTES, PLUGIN_API_VERSION, PLUGIN_CAPABILITIES, PLUGIN_CATEGORIES, PLUGIN_GUIDE_SECTIONS, PLUGIN_MANIFEST_SCHEMA_VERSION, PLUGIN_SOURCE_CONTROL_MAX_FILE_STATS, SENSITIVE_TOOL_FEATURES, TIME_TRACKING_STOP_KEY, TOOL_FORMATS, addRecurrence, assertValidPluginBundles, assertValidPluginCatalogEntry, assertValidPluginManifest, calendarDates, calendarDocumentBytes, checkPluginCompatibility, civilDateTimeAt, codeDocumentUri, codeLanguageForPath, commentAnchorMatches, detectPluginKanbanSourceFormat, emojiPickerMatchesManifest, emptyClockModel, exportTimeTrackingSessions, isCalendarDate, isCalendarFolder, isCalendarNotePath, isCodeJson, isCodeLocation, isCodePath, isCodePosition, isCodeRange, isEmojiSequence, isPluginAuthoringRegistration, isPluginAuthoringRequest, isPluginAuthoringResult, isPluginAuthoringResultFor, isPluginCalendarModel, isPluginCalendarRegistration, isPluginCalendarRequest, isPluginClockModel, isPluginClockRegistration, isPluginClockRequest, isPluginCodeRegistration, isPluginCodeRequest, isPluginCodeResult, isPluginCommentAnchor, isPluginDiagramRenderResult, isPluginDiagramRendererRegistration, isPluginEmojiPicker, isPluginEmojiPreferences, isPluginKanbanBoardModel, isPluginKanbanBoardRequest, isPluginKanbanEdit, isPluginKanbanEditRequest, isPluginKanbanEditResult, isPluginKanbanRegistration, isPluginNoteGraphIndexRequest, isPluginNoteGraphModel, isPluginNoteGraphQuery, isPluginNoteGraphRegistration, isPluginReminderModel, isPluginReminderMutationRequest, isPluginReminderQuery, isPluginReminderRecurrence, isPluginReminderRegistration, isPluginReminderTargetsModel, isPluginReminderTargetsRequest, isPluginSensitiveToolRegistration, isPluginStructuredViewModel, isPluginStructuredViewerRegistration, isPluginTaskListIndexRequest, isPluginTaskListModel, isPluginTaskListQuery, isPluginTaskListRegistration, isPluginTaskListToggleRequest, isPluginTaskListToggleResult, isPluginTimeTrackingClock, isPluginTimeTrackingModel, isPluginTimeTrackingRegistration, isPluginTimeTrackingRequest, isPluginTimeTrackingSession, isPluginTimeTrackingTarget, isReminderLocalDateTime, isReminderTimeZone, isTaskListDate, isToolParseRequest, isToolParseResult, isToolParseResultFor, isToolRegistration, nextRecurringSchedule, parsePluginManifest, parseToolDiagnostics, pendingClockDelivery, record, reorderedPresentationBody, resolveReminderSchedule, resolveWallClock, ringingClocks, textStyleDelimiter, timeTrackingSessionElapsed, timeTrackingTotals, truncateUtf8, validatePluginBundles, validatePluginCatalogEntry, validatePluginManifest, verifiedAuthoringEdit };
