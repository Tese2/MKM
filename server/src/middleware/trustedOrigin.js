const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

function configuredClientOrigins() {
    const envValue = process.env.CLIENT_URL ?? 'http://localhost:5173';
    const origins = new Set(
        envValue
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean)
            .map((value) => new URL(value).origin)
    );

    ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'https://mkmroad.netlify.app'].forEach((origin) => {
        origins.add(origin);
    });

    return origins;
}

export function requireTrustedOrigin(request, response, next) {
    if (safeMethods.has(request.method))
        return next();

    const origin = request.get('origin');
    if (!origin) {
        return response.status(403).json({
            success: false,
            message: 'A trusted request origin is required.',
            code: 'UNTRUSTED_ORIGIN',
        });
    }

    try {
        const requestOrigin = new URL(origin).origin;
        if (!configuredClientOrigins().has(requestOrigin)) {
            return response.status(403).json({
                success: false,
                message: 'Requests from this origin are not allowed.',
                code: 'UNTRUSTED_ORIGIN',
            });
        }
    } catch {
        return response.status(403).json({
            success: false,
            message: 'Requests from this origin are not allowed.',
            code: 'UNTRUSTED_ORIGIN',
        });
    }

    return next();
}
