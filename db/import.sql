-- Generado por scripts/export-state-to-sql.js el 2026-10-24T16:16:26.825Z
-- Aplicar después de db/schema.postgres.sql

BEGIN;

INSERT INTO professionals (id, firebase_uid, name, email, profession, role, password_salt, password_hash, email_verified, firebase_disabled, created_at)
VALUES ('11a31c4f-7143-4dc1-b4c6-fb272ab6cc2f', 'Oy0Td9fP4meinPnvoxfXFoMSIV53', 'Jose', 'jh9130010@gmail.com', NULL, 'user', '1af0ccab13c700d1915eab2c122a5011', 'af9b61630be6d2e88aa1e102226031b116158be17cf22abb2f780da7fc4545aa4f9cb5ad6c92d74bef2f391a3283d7949c3e795c03f6244e4ee35588ec433189', TRUE, FALSE, '2026-10-21T19:05:08.410Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO professionals (id, firebase_uid, name, email, profession, role, password_salt, password_hash, email_verified, firebase_disabled, created_at)
VALUES ('6e2bd46e-2fec-4734-bde0-d04045e6380c', 'edWe531yp0VwFdpoiV3YI2cFHBO2', 'Ivan', 'ir674389@gmail.com', 'Usuario INETER', 'user', '2e0d1ad950a0618ee122a0e0998ab4cb', 'd137d54146986fe045e44767dad5efa7698af64be4f04433d6c7df2aa8b11eb329b56fbdae0b6c8415284bf65195ce4e63081aecfc517c2142dbf99ad31fbd9f', TRUE, FALSE, '2026-10-21T21:34:47.526Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO professionals (id, firebase_uid, name, email, profession, role, password_salt, password_hash, email_verified, firebase_disabled, created_at)
VALUES ('8a38b3f8-fcbc-40b5-b345-4d76d0e0427e', '6GF8BypMf7RYmTf7EMQWkNtwJjE2', 'Darwin', 'darwinrojasgonzales098@gmail.com', 'Profesional', 'professional', '50e4803d4e6c5a788b6fda9201fc784e', '495fa92c44aef069e2e6372b78ad4bd7cff85f3c9878d485af4e45c13171c15640c0f17e918a044bbc90b945a6e9cbc83f3d7a99e68378f0bb02798d87a64e57', TRUE, FALSE, '2026-10-21T22:57:36.477Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO professionals (id, firebase_uid, name, email, profession, role, password_salt, password_hash, email_verified, firebase_disabled, created_at)
VALUES ('qauNkVVBZkMIlo8jTRBbblVGtD82', 'R1BSc5yJp3NXSKFuouFFYyhqh382', 'Darwin Antonio', 'darwinantoniorojas1230@gmail.com', 'Administración principal INETER', 'admin', NULL, NULL, TRUE, FALSE, '2026-10-21T23:20:50.336Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO professionals (id, firebase_uid, name, email, profession, role, password_salt, password_hash, email_verified, firebase_disabled, created_at)
VALUES ('8nrSCWIN4kOuq6AYzvxoCQbc4db2', '23MGJksNo5eHxTXBWaldiueOD3q2', 'Marshall', 'ir5095881@gmail.com', 'Profesional', 'professional', NULL, NULL, TRUE, FALSE, '2026-10-22T02:56:56.551Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO auth_sessions (token_hash, user_id, scope, expires_at)
VALUES ('68355bf8c5eb8270262bf54f939da353cccf63a8afe377259d344537d6159643', '6e2bd46e-2fec-4734-bde0-d04045e6380c', NULL, '2026-10-28T21:34:47.527Z')
ON CONFLICT (token_hash) DO NOTHING;

INSERT INTO auth_sessions (token_hash, user_id, scope, expires_at)
VALUES ('b5cad12cdea5f4a1447b08675ce487b7329ca626040071bcf7190339a3bb95fc', '8nrSCWIN4kOuq6AYzvxoCQbc4db2', NULL, '2026-10-29T02:56:56.555Z')
ON CONFLICT (token_hash) DO NOTHING;

INSERT INTO auth_sessions (token_hash, user_id, scope, expires_at)
VALUES ('246a1c70b4847d92965cb62ef29aeedeea1e4b497d1dddef0d0eb2f327983932', '8nrSCWIN4kOuq6AYzvxoCQbc4db2', NULL, '2026-10-29T03:09:48.879Z')
ON CONFLICT (token_hash) DO NOTHING;

INSERT INTO auth_sessions (token_hash, user_id, scope, expires_at)
VALUES ('9c3e78003640caee9f512af852712b47f79688783a758cf1a7555aae6154246a', '8nrSCWIN4kOuq6AYzvxoCQbc4db2', NULL, '2026-10-29T03:10:39.586Z')
ON CONFLICT (token_hash) DO NOTHING;

INSERT INTO auth_sessions (token_hash, user_id, scope, expires_at)
VALUES ('f78903db2393914b61c6c73edba53063197ec5739c435ef43d5e4a8cc3cbe460', '6e2bd46e-2fec-4734-bde0-d04045e6380c', NULL, '2026-10-29T04:53:34.508Z')
ON CONFLICT (token_hash) DO NOTHING;

INSERT INTO auth_sessions (token_hash, user_id, scope, expires_at)
VALUES ('b13140f7ed9daffa894244a172c9ea0d15a38e469be81f24d67b87b033fa9285', 'qauNkVVBZkMIlo8jTRBbblVGtD82', NULL, '2026-10-29T17:41:32.568Z')
ON CONFLICT (token_hash) DO NOTHING;

INSERT INTO auth_sessions (token_hash, user_id, scope, expires_at)
VALUES ('e789c47a57a3ba56f024f0af862b697f7b459de74b12f76e4fc554bbc3bb19a6', 'qauNkVVBZkMIlo8jTRBbblVGtD82', NULL, '2026-10-29T17:41:32.838Z')
ON CONFLICT (token_hash) DO NOTHING;

INSERT INTO auth_sessions (token_hash, user_id, scope, expires_at)
VALUES ('66cc933c7453dd94fb0893308d4061b88ecfdb1d0ec95d0de253b02fff3814b0', 'qauNkVVBZkMIlo8jTRBbblVGtD82', NULL, '2026-10-29T17:41:32.880Z')
ON CONFLICT (token_hash) DO NOTHING;

INSERT INTO auth_sessions (token_hash, user_id, scope, expires_at)
VALUES ('e61a3ae59b7dc5652ac44cacf1924f625d83f6b4929681dc69a0b37b48c59ccb', 'qauNkVVBZkMIlo8jTRBbblVGtD82', NULL, '2026-10-29T17:41:33.041Z')
ON CONFLICT (token_hash) DO NOTHING;

INSERT INTO auth_sessions (token_hash, user_id, scope, expires_at)
VALUES ('a00ba55bb87892e3002079d2eef7b735ff2a6272f63cb939b4f8078388e84418', 'qauNkVVBZkMIlo8jTRBbblVGtD82', NULL, '2026-10-29T17:41:33.546Z')
ON CONFLICT (token_hash) DO NOTHING;

INSERT INTO auth_sessions (token_hash, user_id, scope, expires_at)
VALUES ('baa6ed0f49ff07a9e447628aa166ffbed534d896e8d29be26393582ac8da09ee', '6e2bd46e-2fec-4734-bde0-d04045e6380c', NULL, '2026-10-29T19:51:18.742Z')
ON CONFLICT (token_hash) DO NOTHING;

INSERT INTO auth_sessions (token_hash, user_id, scope, expires_at)
VALUES ('6f345d2a43c0ad9b2c40cbb14fa7b54e2b1535cf0ef716d91fa7bf0ae026a14e', 'qauNkVVBZkMIlo8jTRBbblVGtD82', NULL, '2026-10-29T20:16:00.355Z')
ON CONFLICT (token_hash) DO NOTHING;

INSERT INTO auth_sessions (token_hash, user_id, scope, expires_at)
VALUES ('840d6de978ea7abdc78d3b550b3358039f32ec093f66de6d2f17cb48fc5f00a2', 'qauNkVVBZkMIlo8jTRBbblVGtD82', NULL, '2026-10-30T04:02:56.063Z')
ON CONFLICT (token_hash) DO NOTHING;

INSERT INTO auth_sessions (token_hash, user_id, scope, expires_at)
VALUES ('4b41f994c705571c3bf8dab78993cc86897b27b93c91f190b5b40f0a8e6cb402', 'qauNkVVBZkMIlo8jTRBbblVGtD82', NULL, '2026-10-30T04:02:56.575Z')
ON CONFLICT (token_hash) DO NOTHING;

INSERT INTO auth_sessions (token_hash, user_id, scope, expires_at)
VALUES ('fcaaa329b1b25c460dbe2662a5317b59301f9d29c89333b7f6e5020b23b21bf3', 'qauNkVVBZkMIlo8jTRBbblVGtD82', NULL, '2026-10-30T16:41:46.247Z')
ON CONFLICT (token_hash) DO NOTHING;

INSERT INTO auth_sessions (token_hash, user_id, scope, expires_at)
VALUES ('a40754482f909f8a4d1b2c055b159733a8353130efbc1eef41268836f8e70b4f', 'qauNkVVBZkMIlo8jTRBbblVGtD82', NULL, '2026-10-30T16:54:47.963Z')
ON CONFLICT (token_hash) DO NOTHING;

INSERT INTO auth_sessions (token_hash, user_id, scope, expires_at)
VALUES ('5cf8bc917e860f5b3d41a8624036f30b354d8ad594424d6fb97a6e1d808fa6cc', '6e2bd46e-2fec-4734-bde0-d04045e6380c', NULL, '2026-10-30T17:13:08.345Z')
ON CONFLICT (token_hash) DO NOTHING;

INSERT INTO auth_sessions (token_hash, user_id, scope, expires_at)
VALUES ('6abea2c8dcacdbe3d8a5d80e8c69d4473119888f19294f52137172094f0fd568', '6e2bd46e-2fec-4734-bde0-d04045e6380c', NULL, '2026-10-30T17:26:25.255Z')
ON CONFLICT (token_hash) DO NOTHING;

INSERT INTO auth_sessions (token_hash, user_id, scope, expires_at)
VALUES ('cbaf7b937baa901b32c1caa25443902687ea4582a62752f3f771ecdf3466ef28', '6e2bd46e-2fec-4734-bde0-d04045e6380c', NULL, '2026-10-30T17:29:30.549Z')
ON CONFLICT (token_hash) DO NOTHING;

INSERT INTO auth_sessions (token_hash, user_id, scope, expires_at)
VALUES ('4788d736287137dbc5b4237c431eef45b6de33b63c1b85443912f98d55e2bf2f', '6e2bd46e-2fec-4734-bde0-d04045e6380c', NULL, '2026-10-30T18:16:42.976Z')
ON CONFLICT (token_hash) DO NOTHING;

INSERT INTO auth_sessions (token_hash, user_id, scope, expires_at)
VALUES ('b60612b95645745fe6ffa03134138a988bfec14caa0739baa34f0efdf4c779ed', '6e2bd46e-2fec-4734-bde0-d04045e6380c', NULL, '2026-10-30T18:22:54.633Z')
ON CONFLICT (token_hash) DO NOTHING;

INSERT INTO auth_sessions (token_hash, user_id, scope, expires_at)
VALUES ('3085c29209139a80fff26f15c3461cd90a6ce2e1bf68b7c55478a2b8a6a1cd1f', 'qauNkVVBZkMIlo8jTRBbblVGtD82', NULL, '2026-10-30T19:29:42.105Z')
ON CONFLICT (token_hash) DO NOTHING;

INSERT INTO auth_sessions (token_hash, user_id, scope, expires_at)
VALUES ('83b992404f7d4bb5ac8ab1e92477d5dd690fa9a3f3a4a6c63c1189f5a5021bfa', 'qauNkVVBZkMIlo8jTRBbblVGtD82', NULL, '2026-10-30T19:31:08.529Z')
ON CONFLICT (token_hash) DO NOTHING;

INSERT INTO auth_sessions (token_hash, user_id, scope, expires_at)
VALUES ('3e00d19402c267f5ee0129065d012e42f82ba2727c3ad1493255a092b85706d4', 'qauNkVVBZkMIlo8jTRBbblVGtD82', NULL, '2026-10-30T19:37:01.521Z')
ON CONFLICT (token_hash) DO NOTHING;

INSERT INTO auth_sessions (token_hash, user_id, scope, expires_at)
VALUES ('68697920909002f7e7a39418ac2d4dfe0e3616b7023e59eb8f535c0053d21e36', 'qauNkVVBZkMIlo8jTRBbblVGtD82', NULL, '2026-10-30T19:37:19.381Z')
ON CONFLICT (token_hash) DO NOTHING;

INSERT INTO auth_sessions (token_hash, user_id, scope, expires_at)
VALUES ('e5d0e45cb317f7b56bc87f4bbe8458a79b9d3ae46b197275e8502761cfbbb91a', 'qauNkVVBZkMIlo8jTRBbblVGtD82', NULL, '2026-10-30T20:16:33.334Z')
ON CONFLICT (token_hash) DO NOTHING;

INSERT INTO auth_sessions (token_hash, user_id, scope, expires_at)
VALUES ('172d8f587782cbfbc03741142b01f30bb4e3201e1f8a66bf2e2b62bffc17dd4e', 'qauNkVVBZkMIlo8jTRBbblVGtD82', NULL, '2026-10-30T20:45:36.034Z')
ON CONFLICT (token_hash) DO NOTHING;

INSERT INTO auth_sessions (token_hash, user_id, scope, expires_at)
VALUES ('949adceacb1c4680da47f14ef59a3fc01f2f9a581f0af778e0873159d38e7079', 'qauNkVVBZkMIlo8jTRBbblVGtD82', NULL, '2026-10-30T21:16:45.693Z')
ON CONFLICT (token_hash) DO NOTHING;

INSERT INTO auth_sessions (token_hash, user_id, scope, expires_at)
VALUES ('ce77254ade925fea43435f8cf7c9d05fdbf4a265a5d42bc7c41f0a79c0b33ad4', 'qauNkVVBZkMIlo8jTRBbblVGtD82', NULL, '2026-10-30T21:17:19.430Z')
ON CONFLICT (token_hash) DO NOTHING;

INSERT INTO auth_sessions (token_hash, user_id, scope, expires_at)
VALUES ('0ebd8addb0678b95083a31619fde96fc4af071b2a2351f59edf0b7b6e0f98e79', 'qauNkVVBZkMIlo8jTRBbblVGtD82', 'monitor', '2026-10-23T22:17:41.112Z')
ON CONFLICT (token_hash) DO NOTHING;

INSERT INTO destinations (id, platform, name, server_url, secret_encrypted)
VALUES ('d2a758fd-f988-4b60-915d-b10cb499fff3'::uuid, 'YouTube', '@josehernandez-s1v9t', 'rtmp://a.rtmp.youtube.com/live2', 'f26b56963d781c173addc171:4f94b3b0787b1ad18028dc0ba6aa55bb:fa02677e5366c8690f9a564e6b22b90824c7b8d8aa60dcd1')
ON CONFLICT (id) DO NOTHING;

INSERT INTO destinations (id, platform, name, server_url, secret_encrypted)
VALUES ('874bc25b-1e65-4540-9d0a-6a215c05c446'::uuid, 'YouTube', '@KomiNacatamal', 'rtmp://x.rtmp.youtube.com/live2', '7d6dfe79be2b1cae2185096a:267307057d4b20b280ce580243d1c45c:12cd62028360bce1963b3a1581f889c2531cb013a0d0c825')
ON CONFLICT (id) DO NOTHING;

INSERT INTO sessions (id, started_at, ended_at, recording, destinations, status)
VALUES ('f7824283-042b-4672-b957-c50326afa083'::uuid, '2026-10-21T16:50:45.923Z', '2026-10-21T17:01:56.248Z', 'MediaMTX', '[]'::jsonb, 'guardada')
ON CONFLICT (id) DO NOTHING;

INSERT INTO sessions (id, started_at, ended_at, recording, destinations, status)
VALUES ('ce5a73e5-804e-4347-bb5a-f29db0e5951d'::uuid, '2026-10-21T17:11:22.442Z', '2026-10-21T17:12:18.006Z', 'MediaMTX', '["@josehernandez-s1v9t"]'::jsonb, 'guardada')
ON CONFLICT (id) DO NOTHING;

INSERT INTO sessions (id, started_at, ended_at, recording, destinations, status)
VALUES ('a51444ca-4b97-4cec-a1d8-4551f3902d05'::uuid, '2026-10-21T17:13:27.811Z', '2026-10-21T17:13:32.745Z', 'MediaMTX', '["@josehernandez-s1v9t"]'::jsonb, 'guardada')
ON CONFLICT (id) DO NOTHING;

INSERT INTO sessions (id, started_at, ended_at, recording, destinations, status)
VALUES ('38b184ad-6838-42ae-a099-8eb64a4c7915'::uuid, '2026-10-21T17:47:24.394Z', '2026-10-21T17:53:20.741Z', 'MediaMTX', '["@josehernandez-s1v9t"]'::jsonb, 'guardada')
ON CONFLICT (id) DO NOTHING;

INSERT INTO sessions (id, started_at, ended_at, recording, destinations, status)
VALUES ('81943569-edb0-4f3b-bf4a-a5c5bfbce895'::uuid, '2026-10-22T18:16:02.254Z', '2026-10-22T18:19:17.049Z', 'MediaMTX', '["@josehernandez-s1v9t"]'::jsonb, 'guardada')
ON CONFLICT (id) DO NOTHING;

INSERT INTO alerts (id, category, category_label, severity, severity_label, title, location, message, source_name, source_url, author, recipient_count, email_accepted, email_status, email_error, email_sent_at, firebase_status, push_accepted, firebase_error, created_at)
VALUES ('b1912c79-0002-4fb5-a764-ba51ca93aeec'::uuid, 'tsunami', 'Tsunami', 'urgente', 'Urgente', 'los vana matar', 'Carazo', 'vini corono una gorda y tuvo un accidente en una playa del litoral pacifico nicaraguense levantando una ola de 39 mts de altura se recomienda resarel padre nuestro', 'INETER', 'https://www.ineter.gob.ni/', 'Darwin Antonio', 5, 0, 'sin_configuracion', 'Configura RESEND_API_KEY y ALERT_FROM_EMAIL en .env.', NULL, 'publicado', 3, NULL, '2026-10-22T20:19:12.373Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO alerts (id, category, category_label, severity, severity_label, title, location, message, source_name, source_url, author, recipient_count, email_accepted, email_status, email_error, email_sent_at, firebase_status, push_accepted, firebase_error, created_at)
VALUES ('dae3556f-3d56-46c9-bd2c-8a298af04a85'::uuid, 'volcanica', 'Volcánica', 'precaucion', 'Precaución', 'Vini Bailo la danza del volcan', 'Carazo', 'Volcan masaya en erupcion', 'NOAH', 'https://www.ineter.gob.ni/', 'Darwin Antonio', 5, 0, 'sin_configuracion', 'Configura RESEND_API_KEY y ALERT_FROM_EMAIL en .env.', NULL, 'publicado', 3, NULL, '2026-10-23T17:15:25.266Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO alerts (id, category, category_label, severity, severity_label, title, location, message, source_name, source_url, author, recipient_count, email_accepted, email_status, email_error, email_sent_at, firebase_status, push_accepted, firebase_error, created_at)
VALUES ('ba9628ef-527f-40f6-8caa-e6b1b4417296'::uuid, 'volcanica', 'Volcánica', 'informativa', 'Informativa', 'Volcan Masaya', 'Masaya', 'hubouna serie de erupciones en el crater santigio hace unos 3 min se recomienda a la poblacion cercana estar alerta', 'INETER', 'https://www.ineter.gob.ni/', 'Darwin Antonio', 4, 0, 'sin_configuracion', 'Configura RESEND_API_KEY y ALERT_FROM_EMAIL en .env.', NULL, 'publicado', 3, NULL, '2026-10-23T17:28:56.408Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO alerts (id, category, category_label, severity, severity_label, title, location, message, source_name, source_url, author, recipient_count, email_accepted, email_status, email_error, email_sent_at, firebase_status, push_accepted, firebase_error, created_at)
VALUES ('9c5ecc28-78af-4044-be80-ee75af64c1a5'::uuid, 'meteorologica', 'Meteorológica', 'informativa', 'Informativa', 'lluvia', 'Masaya', 'fuertes lluvias', 'INETER', 'https://www.ineter.gob.ni/', 'Darwin Antonio', 4, 0, 'fallido', 'Invalid `to` field. Please use our testing email address instead of domains like `example.com`. See our documentation for more information.', '2026-10-23T19:33:19.254Z', 'publicado', 3, NULL, '2026-10-23T18:17:38.751Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO alerts (id, category, category_label, severity, severity_label, title, location, message, source_name, source_url, author, recipient_count, email_accepted, email_status, email_error, email_sent_at, firebase_status, push_accepted, firebase_error, created_at)
VALUES ('8bc2c42e-a018-4e45-9438-089774ba4ee7'::uuid, 'meteorologica', 'Meteorológica', 'informativa', 'Informativa', 'lluvia', 'Carazo', 'Caera elver', 'INETER', 'https://www.ineter.gob.ni/', 'Darwin Antonio', 5, 0, 'fallido', 'Invalid `to` field. Please use our testing email address instead of domains like `example.com`. See our documentation for more information.', '2026-10-23T21:19:24.242Z', 'publicado', 3, NULL, '2026-10-23T21:19:23.234Z')
ON CONFLICT (id) DO NOTHING;

INSERT INTO push_tokens (user_id, token, created_at)
VALUES ('11a31c4f-7143-4dc1-b4c6-fb272ab6cc2f', 'dc3zDi7f2gFR5ybeZKgyrS:APA91bG0GJDoX46Vb0Oyixlqwxj4LiUxzZ4JdErsbLoJOzMJan2HBCMUDm8W9oUWooRlzYLnJnOyqFQCSz_LfEEbbNtuPN8052PBvqerzjTBJkvUP4LtPHg', '2026-10-21T23:07:57.879Z')
ON CONFLICT (user_id, token) DO NOTHING;

INSERT INTO push_tokens (user_id, token, created_at)
VALUES ('qauNkVVBZkMIlo8jTRBbblVGtD82', 'dNSscpLCkewJnpzjDrKpAe:APA91bHaXaUCm2P-VaDYqq3KSnwW89KTOkCFd811aLzyaHiOQwLWG983EsIaEt73DXdd3qhd0W66MR9F8cyuzdbymsafloQ_CrA1mHnxOvdqg2aaZ4SuSck', '2026-10-21T23:48:51.489Z')
ON CONFLICT (user_id, token) DO NOTHING;

INSERT INTO push_tokens (user_id, token, created_at)
VALUES ('8nrSCWIN4kOuq6AYzvxoCQbc4db2', 'c9DWkvcWnGOFwNw1EMn-Dl:APA91bEFj5xg6dvVPSr36NHWBsC-_P2VHoelG8UF8GIsDsBTlsiF5cxtBTty18l-PHKAwrOPdeYpsV3T4Ew0m8oeQR32RrIKk7-NX9y0HhU8Hhjl7llhm0U', '2026-10-22T03:00:08.446Z')
ON CONFLICT (user_id, token) DO NOTHING;

INSERT INTO obs_config (id, host, port, secret_encrypted)
VALUES (1, '192.168.0.14', 4455, 'a9ae9ae01e60e554a2d1f350:47fec0e56e5dd0e086d25028c01c9dd5:f8088367b820cc247b27612a71b2ff19')
ON CONFLICT (id) DO NOTHING;

INSERT INTO app_state (key, value) VALUES ('likes', '{}'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();

INSERT INTO app_state (key, value) VALUES ('studio', '{"studio":"OBS"}'::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();

COMMIT;
