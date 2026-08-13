# Archivo Divergente

Biblioteca personal, mobile-first y de sólo lectura. El sitio se publica en GitHub Pages; los archivos originales se sirven desde `https://agilpm.com/conocimiento`.

## Preparación inicial

```bash
npm install
npm run catalog
npm run dev
```

El catálogo se genera a partir de las carpetas existentes. `taxonomy.yml` controla los cuatro territorios y los nombres de las colecciones. Cada `recursos.yml` conserva los identificadores, títulos y tags editables de sus archivos. Cada `descripcion.md` se procesa como un análisis Markdown independiente, consultable dentro de su colección y mediante el filtro **Análisis**.

## Agregar contenido

1. Copia el archivo nuevo en su carpeta local.
2. Súbelo a la misma ruta dentro de `agilpm.com/conocimiento` sin cambiar el nombre.
3. Ejecuta `npm run publicar`.
4. Revisa el resumen y confirma el commit/push.

El comando actualiza metadatos, miniaturas, texto extraído y OCR; valida las URLs remotas; ejecuta pruebas y compila el sitio. Si aún no instalaste los encabezados del servidor, puedes preparar una versión local con `npm run publicar -- --skip-verify --no-git`.

## Servidor de recursos

Los archivos listos para copiar a ÁgilPM están en `server/agilpm/`. Incluyen los encabezados CORS, MIME, soporte de rangos y el endpoint de descarga explícita.

## GitHub Pages

El workflow `.github/workflows/deploy-pages.yml` publica `dist` al hacer push sobre `main`. En la configuración del repositorio selecciona **GitHub Actions** como origen de Pages.

Los PDF, audios, videos, imágenes originales y DOCX están ignorados por Git. Sólo se versionan el sitio, las descripciones, `recursos.yml`, miniaturas e índices de búsqueda.

> Importante: antes del primer push, confirma que cuentas con los derechos necesarios para publicar las descripciones, miniaturas y recursos enlazados. La visibilidad del repositorio no restringe el acceso a los archivos si `agilpm.com/conocimiento` es público.

## Comandos

- `npm run dev`: vista previa local.
- `npm run catalog`: regenera catálogo, OCR e índices.
- `npm test`: valida integridad y ausencia de binarios en Pages.
- `npm run build`: genera el sitio estático en `dist`.
- `npm run publicar`: prepara y publica una actualización de contenido.
