CREATE TABLE "statsarena"."auth_mcp_access_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"client_id" text NOT NULL,
	"session_id" text,
	"user_id" text,
	"reference_id" text,
	"authorization_code_id" text,
	"resources" text[],
	"requested_user_info_claims" text[],
	"refresh_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"revoked" timestamp with time zone,
	"confirmation" jsonb,
	"scopes" text[] NOT NULL,
	CONSTRAINT "auth_mcp_access_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "statsarena"."auth_mcp_client_assertions" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statsarena"."auth_mcp_client_resources" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "statsarena"."auth_mcp_clients" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"client_secret" text,
	"client_discovery_id" text,
	"disabled" boolean DEFAULT false,
	"skip_consent" boolean,
	"enable_end_session" boolean,
	"subject_type" text,
	"scopes" text[],
	"client_credentials_scopes" text[] DEFAULT '{}'::text[],
	"user_id" text,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"name" text,
	"uri" text,
	"icon" text,
	"contacts" text[],
	"tos" text,
	"policy" text,
	"software_id" text,
	"software_version" text,
	"software_statement" text,
	"redirect_uris" text[] NOT NULL,
	"post_logout_redirect_uris" text[],
	"backchannel_logout_uri" text,
	"backchannel_logout_session_required" boolean,
	"token_endpoint_auth_method" text,
	"application_type" text,
	"jwks" text,
	"jwks_uri" text,
	"grant_types" text[],
	"response_types" text[],
	"require_pkce" boolean,
	"dpop_bound_access_tokens" boolean DEFAULT false,
	"reference_id" text,
	"metadata" jsonb,
	CONSTRAINT "auth_mcp_clients_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "statsarena"."auth_mcp_consents" (
	"id" text PRIMARY KEY NOT NULL,
	"client_id" text NOT NULL,
	"user_id" text,
	"reference_id" text,
	"resources" text[],
	"requested_user_info_claims" text[],
	"scopes" text[] NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "statsarena"."auth_mcp_jwks" (
	"id" text PRIMARY KEY NOT NULL,
	"public_key" text NOT NULL,
	"private_key" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"alg" text,
	"crv" text
);
--> statement-breakpoint
CREATE TABLE "statsarena"."auth_mcp_refresh_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"client_id" text NOT NULL,
	"session_id" text,
	"user_id" text NOT NULL,
	"reference_id" text,
	"authorization_code_id" text,
	"resources" text[],
	"requested_user_info_claims" text[],
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"revoked" timestamp with time zone,
	"rotated_at" timestamp with time zone,
	"rotation_replay_response" text,
	"rotation_replay_expires_at" timestamp with time zone,
	"auth_time" timestamp with time zone,
	"confirmation" jsonb,
	"scopes" text[] NOT NULL,
	CONSTRAINT "auth_mcp_refresh_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "statsarena"."auth_mcp_resources" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"name" text NOT NULL,
	"access_token_ttl" integer,
	"refresh_token_ttl" integer,
	"signing_algorithm" text,
	"signing_key_id" text,
	"allowed_scopes" text[],
	"custom_claims" jsonb,
	"dpop_bound_access_tokens_required" boolean DEFAULT false,
	"disabled" boolean DEFAULT false,
	"created_at" timestamp with time zone,
	"updated_at" timestamp with time zone,
	"policy_version" integer DEFAULT 1,
	"metadata" jsonb,
	CONSTRAINT "auth_mcp_resources_identifier_unique" UNIQUE("identifier")
);
--> statement-breakpoint
ALTER TABLE "statsarena"."auth_mcp_access_tokens" ADD CONSTRAINT "auth_mcp_access_tokens_client_id_auth_mcp_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "statsarena"."auth_mcp_clients"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."auth_mcp_access_tokens" ADD CONSTRAINT "auth_mcp_access_tokens_session_id_auth_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "statsarena"."auth_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."auth_mcp_access_tokens" ADD CONSTRAINT "auth_mcp_access_tokens_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "statsarena"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."auth_mcp_access_tokens" ADD CONSTRAINT "auth_mcp_access_tokens_refresh_id_auth_mcp_refresh_tokens_id_fk" FOREIGN KEY ("refresh_id") REFERENCES "statsarena"."auth_mcp_refresh_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."auth_mcp_client_resources" ADD CONSTRAINT "auth_mcp_client_resources_client_id_auth_mcp_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "statsarena"."auth_mcp_clients"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."auth_mcp_client_resources" ADD CONSTRAINT "auth_mcp_client_resources_resource_id_auth_mcp_resources_identifier_fk" FOREIGN KEY ("resource_id") REFERENCES "statsarena"."auth_mcp_resources"("identifier") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."auth_mcp_clients" ADD CONSTRAINT "auth_mcp_clients_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "statsarena"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."auth_mcp_consents" ADD CONSTRAINT "auth_mcp_consents_client_id_auth_mcp_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "statsarena"."auth_mcp_clients"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."auth_mcp_consents" ADD CONSTRAINT "auth_mcp_consents_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "statsarena"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."auth_mcp_refresh_tokens" ADD CONSTRAINT "auth_mcp_refresh_tokens_client_id_auth_mcp_clients_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "statsarena"."auth_mcp_clients"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."auth_mcp_refresh_tokens" ADD CONSTRAINT "auth_mcp_refresh_tokens_session_id_auth_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "statsarena"."auth_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statsarena"."auth_mcp_refresh_tokens" ADD CONSTRAINT "auth_mcp_refresh_tokens_user_id_auth_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "statsarena"."auth_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_mcp_access_client_idx" ON "statsarena"."auth_mcp_access_tokens" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "auth_mcp_access_user_idx" ON "statsarena"."auth_mcp_access_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_mcp_access_session_idx" ON "statsarena"."auth_mcp_access_tokens" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "auth_mcp_access_refresh_idx" ON "statsarena"."auth_mcp_access_tokens" USING btree ("refresh_id");--> statement-breakpoint
CREATE INDEX "auth_mcp_access_code_idx" ON "statsarena"."auth_mcp_access_tokens" USING btree ("authorization_code_id");--> statement-breakpoint
CREATE INDEX "auth_mcp_assertion_expiry_idx" ON "statsarena"."auth_mcp_client_assertions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_mcp_client_resource_uq" ON "statsarena"."auth_mcp_client_resources" USING btree ("client_id","resource_id");--> statement-breakpoint
CREATE INDEX "auth_mcp_client_resource_idx" ON "statsarena"."auth_mcp_client_resources" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "auth_mcp_clients_user_idx" ON "statsarena"."auth_mcp_clients" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_mcp_consent_client_idx" ON "statsarena"."auth_mcp_consents" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "auth_mcp_consent_user_idx" ON "statsarena"."auth_mcp_consents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_mcp_refresh_client_idx" ON "statsarena"."auth_mcp_refresh_tokens" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "auth_mcp_refresh_user_idx" ON "statsarena"."auth_mcp_refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_mcp_refresh_session_idx" ON "statsarena"."auth_mcp_refresh_tokens" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "auth_mcp_refresh_code_idx" ON "statsarena"."auth_mcp_refresh_tokens" USING btree ("authorization_code_id");