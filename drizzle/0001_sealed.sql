CREATE TABLE "sealed_lot" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"product_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"unit_cost_cents" integer NOT NULL,
	"bought_on" date,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sealed_price" (
	"product_id" integer NOT NULL,
	"day" date NOT NULL,
	"market" numeric(10, 2),
	"low" numeric(10, 2),
	CONSTRAINT "sealed_price_product_id_day_pk" PRIMARY KEY("product_id","day")
);
--> statement-breakpoint
CREATE TABLE "sealed_sale" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"product_id" integer NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"fees_cents" integer DEFAULT 0 NOT NULL,
	"sold_on" date,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sealed_watch" (
	"user_id" text NOT NULL,
	"product_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "sealed_watch_user_id_product_id_pk" PRIMARY KEY("user_id","product_id")
);
--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "sealed_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sealed_lot" ADD CONSTRAINT "sealed_lot_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sealed_sale" ADD CONSTRAINT "sealed_sale_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sealed_watch" ADD CONSTRAINT "sealed_watch_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sealed_lot_user_idx" ON "sealed_lot" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sealed_lot_user_product_idx" ON "sealed_lot" USING btree ("user_id","product_id");--> statement-breakpoint
CREATE INDEX "sealed_sale_user_idx" ON "sealed_sale" USING btree ("user_id");