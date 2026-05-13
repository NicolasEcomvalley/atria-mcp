# Atria MCP Server

Servidor MCP que conecta Claude con la API de Atria para research de competidores.

## Herramientas disponibles

- **search_ads** — Buscar anuncios por keyword, plataforma, formato
- **get_ad_detail** — Ver detalle completo de un anuncio
- **get_boards** — Ver tus boards guardados
- **get_saved_ads** — Ver anuncios guardados (por board o todos)
- **get_brand_ads** — Ver todos los anuncios de una marca, ordenados por más recientes o más longevos

## Deploy en Railway

1. Sube este código a GitHub (repositorio nuevo)
2. Ve a railway.app y crea cuenta con GitHub
3. "New Project" → "Deploy from GitHub repo" → selecciona el repo
4. En "Variables" agrega: `ATRIA_API_KEY` = tu API key de Atria
5. Railway te dará una URL pública (ej: `https://atria-mcp-production.up.railway.app`)
6. En Claude → Customize → Connectors → Agregar conector personalizado:
   - URL: `https://tu-url.up.railway.app/mcp`

## Variables de entorno requeridas

- `ATRIA_API_KEY`: Tu API key de Atria (la que generaste en Settings → API Keys)
