/**
 * Throwaway, self-signed TLS identity used ONLY by the webhook transport tests to stand in for a
 * remote HTTPS receiver on 127.0.0.1. It protects nothing, is trusted by no one, and is never
 * loaded by application code.
 */
export const TEST_TLS_CERT = `-----BEGIN CERTIFICATE-----
MIIBrDCCAVOgAwIBAgIUWcheFxK5TxyAkwrFRFn6l5M1bn4wCgYIKoZIzj0EAwIw
HTEbMBkGA1UEAwwSbmFnYXItd2ViaG9vay10ZXN0MCAXDTI2MDkzMDE3MTI0MloY
DzIxMjYwOTA2MTcxMjQyWjAdMRswGQYDVQQDDBJuYWdhci13ZWJob29rLXRlc3Qw
WTATBgcqhkjOPQIBBggqhkjOPQMBBwNCAASraMjYuDzbVXycb/Y0vicXLlFB4hh4
ho/3monxwz4qlO8lQZOFpQIvN5DfJbFZmc86W4XU9S5UdQWH4WaW29E5o28wbTAd
BgNVHQ4EFgQUQxcoBiY0vw/qWH1PryfRJoouHPowHwYDVR0jBBgwFoAUQxcoBiY0
vw/qWH1PryfRJoouHPowDwYDVR0TAQH/BAUwAwEB/zAaBgNVHREEEzARhwR/AAAB
gglsb2NhbGhvc3QwCgYIKoZIzj0EAwIDRwAwRAIgHNe6dJ+i88CDKhgAweHkuoGK
rUxMJ64xyypSp4zN6MsCICzJBQxUZdn64bOh/GLHvLbp4WiKKDv0VeNz8xiP18Hm
-----END CERTIFICATE-----
`;

export const TEST_TLS_KEY = `-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQgit2CTyp9iHd0KjuX
2C5x93uy+Wn0X+GaP2MiRobpRIqhRANCAASraMjYuDzbVXycb/Y0vicXLlFB4hh4
ho/3monxwz4qlO8lQZOFpQIvN5DfJbFZmc86W4XU9S5UdQWH4WaW29E5
-----END PRIVATE KEY-----
`;
