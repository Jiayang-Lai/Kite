/** Axios-style HTTP failure details attached to SDK errors as `error.response`. */
type ErrorResponse = {
	status?: number;
	statusText?: string;
	data?: unknown;
	headers?: Record<string, unknown> & { get?: (name: string) => unknown };
};

type KustoErrorContext = {
	clientRequestId?: string;
	activityId?: string;
};

type KustoServiceError = {
	code?: string;
	message?: string;
	'@message'?: string;
	'@database'?: string;
	'@line'?: string | number;
	'@pos'?: string | number;
	'@errorCode'?: string;
	'@errorMessage'?: string;
	'@context'?: KustoErrorContext;
	innererror?: KustoServiceError;
};

function parseResponseData(data: unknown): unknown {
	if (typeof data !== 'string') return data;

	const text = data.trim();
	if (!text.startsWith('{')) return text;

	try {
		return JSON.parse(text);
	} catch {
		return text;
	}
}

function formatStructuredKustoError(error: KustoServiceError) {
	const detail = error.innererror ?? error;
	const context = detail['@context'] ?? error['@context'];
	const code = detail['@errorCode'] ?? detail.code ?? error.code;
	const shortMessage = detail['@errorMessage'] ?? detail.message ?? error.message;
	const technicalMessage = detail['@message'];
	const summary = [code, shortMessage].filter(Boolean).join(': ');
	const location =
		detail['@line'] != null
			? `Line ${detail['@line']}${detail['@pos'] != null ? `, column ${detail['@pos']}` : ''}`
			: '';
	const database = error['@database'] ? `Database: ${error['@database']}` : '';
	const clientRequestId = context?.clientRequestId
		? `Client request ID: ${context.clientRequestId}`
		: '';
	const activityId = context?.activityId ? `Activity ID: ${context.activityId}` : '';

	return [
		summary,
		technicalMessage && technicalMessage !== summary ? technicalMessage : '',
		location,
		database,
		clientRequestId,
		activityId
	]
		.filter(Boolean)
		.join('\n');
}

function formatResponseData(data: unknown) {
	const parsedData = parseResponseData(data);
	if (typeof parsedData === 'string') return parsedData;
	if (!parsedData || typeof parsedData !== 'object') return '';

	const payload = parsedData as {
		message?: string;
		error?: KustoServiceError | string;
	};
	if (typeof payload.error === 'string') return payload.error;
	if (payload.error) return formatStructuredKustoError(payload.error);

	if (payload.message) return payload.message;

	try {
		return JSON.stringify(parsedData, null, 2);
	} catch {
		return '';
	}
}

function getResponseHeader(headers: ErrorResponse['headers'], name: string) {
	return headers?.get?.(name) ?? headers?.[name] ?? headers?.[name.toLowerCase()];
}

/**
 * Produces a user-facing message for any failure in Kite. HTTP failures from the Kusto SDK or
 * other clients include their status, the structured Kusto service error when present, and the
 * activity ID; ordinary errors use their message.
 */
export function getErrorMessage(error: unknown) {
	if (!(error instanceof Error)) return String(error);

	const response = (error as Error & { response?: ErrorResponse }).response;
	if (!response) return error.message;

	const responseMessage = formatResponseData(response.data);
	const status = response.status
		? `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`
		: '';
	const activityId = getResponseHeader(response.headers, 'x-ms-activity-id');
	const activityDetail =
		activityId && !responseMessage.includes(String(activityId)) ? `Activity ID: ${activityId}` : '';

	return [status, responseMessage || error.message, activityDetail].filter(Boolean).join('\n\n');
}
