# Magic Studio Goods video renderer

Service Cloud Run dédié à l’export MP4 de `goods-video.html`.

- Entrée strictement limitée à `https://magicstudioapp.github.io/magic-studio/goods-video.html`.
- Images distantes limitées au compte Cloudinary de Magic Studio.
- Jusqu’à 20 produits et 5 logos par composition.
- Vidéo verticale 1080 × 1920, H.264, 20 images/s, 5 secondes.
- Une file de rendu par instance, une instance Cloud Run maximum recommandée.
- Limite par défaut : 10 créations par adresse IP et par heure.
- Suppression automatique des fichiers après 24 heures.

## Déploiement

Construire l’image depuis la racine du dépôt :

```sh
IMAGE=europe-west1-docker.pkg.dev/f2k-506604/f2k-studio/magic-studio-video:latest
gcloud builds submit --config goods-video-renderer/cloudbuild.yaml --substitutions _IMAGE=$IMAGE .

gcloud run deploy magic-studio-video \
  --project f2k-506604 \
  --image "$IMAGE" \
  --region europe-west1 \
  --allow-unauthenticated \
  --cpu 2 \
  --memory 4Gi \
  --concurrency 10 \
  --min-instances 0 \
  --max-instances 1 \
  --timeout 900 \
  --no-cpu-throttling \
  --set-env-vars ALLOWED_ORIGINS=https://magicstudioapp.github.io,RETENTION_MS=86400000,MAX_JOBS_PER_HOUR=10
```

Le service ne contient aucune clé côté navigateur et ne peut rendre ni HTML arbitraire, ni URL externe arbitraire.
