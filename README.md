# automationCenter

Centro local de automatizaciones para ejecutar revisiones periodicas sobre varios proyectos Git.

El primer objetivo es sencillo:

- leer una lista de proyectos desde `config/projects.json`
- ejecutar checks configurados para cada proyecto
- guardar un informe tecnico en JSON
- generar un informe Markdown entendible por personas no tecnicas

## Ejecutar manualmente

Desde esta carpeta:

```powershell
python .\runner\run_checks.py
```

O usando el script diario:

```powershell
.\scripts\run_daily.ps1
```

Si Windows bloquea la ejecucion de scripts:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run_daily.ps1
```

Los informes se generan en `reports/`.

## Datos persistentes

La app guarda el historico operativo en SQLite:

```text
data/automation.db
```

La API principal para consultar ejecuciones recientes es:

```text
GET /api/runs
```

Los informes de `reports/` siguen existiendo como exportables legibles, pero el dashboard puede calcular metricas desde la base de datos.

## Panel web local

Arrancar sin Docker:

```powershell
python .\app\server.py
```

Arrancar con Docker:

```powershell
docker compose up --build
```

La interfaz queda disponible en `http://localhost:8000`.

## Primer proyecto monitorizado

Ahora mismo esta configurado:

- `myGoogleDrive`

Como todavia esta vacio, el runner comprobara el estado de Git y saltara tests o linters que dependan de archivos que aun no existen.
