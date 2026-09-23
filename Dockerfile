FROM node:22-alpine AS build
WORKDIR /app
ARG VITE_API_BASE_URL
ARG VITE_ENTRA_TENANT_ID
ARG VITE_ENTRA_CLIENT_ID
ARG VITE_ENTRA_API_SCOPE
ARG VITE_AZURE_MAPS_CLIENT_ID
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_ENTRA_TENANT_ID=$VITE_ENTRA_TENANT_ID
ENV VITE_ENTRA_CLIENT_ID=$VITE_ENTRA_CLIENT_ID
ENV VITE_ENTRA_API_SCOPE=$VITE_ENTRA_API_SCOPE
ENV VITE_AZURE_MAPS_CLIENT_ID=$VITE_AZURE_MAPS_CLIENT_ID
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY . .
RUN test -n "$VITE_API_BASE_URL" \
    && test -n "$VITE_ENTRA_TENANT_ID" \
    && test -n "$VITE_ENTRA_CLIENT_ID" \
    && test -n "$VITE_ENTRA_API_SCOPE" \
    && pnpm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
