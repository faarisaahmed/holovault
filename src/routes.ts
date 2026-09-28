import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("login", "routes/login.tsx"),
  route("reset-password", "routes/reset-password.tsx"),
  route("add", "routes/add.tsx"),
  route("collection", "routes/collection.tsx"),
  route("sets", "routes/sets.tsx"),
  route("sets/:setId", "routes/set-detail.tsx"),
  route("pokemon", "routes/pokemon.tsx"),
  route("binders", "routes/binders.tsx"),
  route("binders/:binderId", "routes/binder-detail.tsx"),
  route("grading", "routes/grading.tsx"),
  route("import", "routes/import.tsx"),
  route("settings", "routes/settings.tsx"),
  route("export/:format", "routes/export.tsx"),
  route("api/auth/*", "routes/api.auth.tsx"),
] satisfies RouteConfig;
