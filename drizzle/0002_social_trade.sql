CREATE TABLE "card_price" (
	"card_id" text NOT NULL,
	"finish" text NOT NULL,
	"day" date NOT NULL,
	"market" numeric(10, 2) NOT NULL,
	CONSTRAINT "card_price_card_id_finish_day_pk" PRIMARY KEY("card_id","finish","day")
);
--> statement-breakpoint
CREATE TABLE "wishlist_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"card_id" text NOT NULL,
	"finish" text,
	"target_cents" integer,
	"price_at_add_cents" integer,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "binder" ADD COLUMN "share_token" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "share_token" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "share_show_values" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "wishlist_item" ADD CONSTRAINT "wishlist_item_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_price_day_idx" ON "card_price" USING btree ("day");--> statement-breakpoint
CREATE INDEX "wishlist_user_idx" ON "wishlist_item" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "binder" ADD CONSTRAINT "binder_share_token_unique" UNIQUE("share_token");--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_share_token_unique" UNIQUE("share_token");