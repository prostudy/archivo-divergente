# Integración con agilpm.com

Copia `.htaccess` y `download.php` dentro de `https://agilpm.com/conocimiento/`, junto a las carpetas de recursos.

La regla de Apache habilita CORS y solicitudes por rangos para PDF, audio y video. `download.php` sólo entrega archivos dentro de ese directorio y únicamente en los formatos admitidos por la biblioteca.

Después de copiar ambos archivos, ejecuta `npm run publicar`. La validación se detendrá si una URL remota, CORS o `Accept-Ranges` no responden como espera el visor.
