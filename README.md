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

## Primer proyecto monitorizado

Ahora mismo esta configurado:

- `myGoogleDrive`

Como todavia esta vacio, el runner comprobara el estado de Git y saltara tests o linters que dependan de archivos que aun no existen.
