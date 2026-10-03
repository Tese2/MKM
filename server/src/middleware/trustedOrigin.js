const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

function configuredClientOrigin() {
    return new URL(process.env.CLIENT_URL ?? 'http://localhost:5173').origin;
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
        if (new URL(origin).origin !== configuredClientOrigin()) {
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
