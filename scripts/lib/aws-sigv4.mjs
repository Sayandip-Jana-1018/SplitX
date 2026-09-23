/**
 * AWS Signature Version 4, for the few calls a script makes where the AWS CLI
 * would need a secret on its command line or in a file (D-042: secrets never
 * touch either). The credentials come from `aws configure export-credentials`,
 * held in memory like the values being sent.
 *
 * https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html
 */
import { createHash, createHmac } from 'node:crypto';

const sha256 = (data) => createHash('sha256').update(data, 'utf8').digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data, 'utf8').digest();

/** 20150830T123600Z and 20150830, from a Date. */
export function amzDates(now = new Date()) {
    const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    return { amzDate, date: amzDate.slice(0, 8) };
}

/** The key that signs one day's requests to one service in one region. */
export function signingKey(secretAccessKey, date, region, service) {
    const kDate = hmac('AWS4' + secretAccessKey, date);
    const kRegion = hmac(kDate, region);
    const kService = hmac(kRegion, service);
    return hmac(kService, 'aws4_request');
}

/**
 * Signs a request and returns the headers to send with it.
 * @param {{ method: string, host: string, path?: string, query?: string, headers?: Record<string, string>, body?: string }} request
 *   query must already be canonical (sorted, URI-encoded); scripts here send none.
 * @param {{ accessKeyId: string, secretAccessKey: string, sessionToken?: string }} credentials
 * @returns {Record<string, string>} every header, Authorization included
 */
export function signRequest(request, credentials, { region, service, now = new Date() }) {
    const { amzDate, date } = amzDates(now);
    const body = request.body ?? '';
    const headers = {
        ...Object.fromEntries(Object.entries(request.headers ?? {}).map(([name, value]) => [name.toLowerCase(), String(value).trim()])),
        host: request.host,
        'x-amz-date': amzDate,
        ...(credentials.sessionToken ? { 'x-amz-security-token': credentials.sessionToken } : {}),
    };
    const names = Object.keys(headers).sort();
    const canonicalHeaders = names.map((name) => `${name}:${headers[name]}\n`).join('');
    const signedHeaders = names.join(';');
    const canonicalRequest = [
        request.method,
        request.path ?? '/',
        request.query ?? '',
        canonicalHeaders,
        signedHeaders,
        sha256(body),
    ].join('\n');
    const scope = `${date}/${region}/${service}/aws4_request`;
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
    const signature = createHmac('sha256', signingKey(credentials.secretAccessKey, date, region, service))
        .update(stringToSign, 'utf8').digest('hex');
    return {
        ...headers,
        authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };
}
