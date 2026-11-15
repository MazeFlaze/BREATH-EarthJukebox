#!/usr/bin/env bash
# ==============================================================================
# BREATHE – Earth Information Jukebox
# Azure Container Apps Automated Deployment Script (Scale-to-Zero / Free-Tier)
# ==============================================================================
# This script provisions:
# 1. Azure Resource Group
# 2. Azure Container Registry (ACR)
# 3. Azure Container Apps Environment (Consumption tier, minReplicas=0)
# 4. Backend Container App (FastAPI + Neon PostgreSQL, minReplicas=0)
# 5. Frontend Container App (Next.js Standalone, minReplicas=0)
#
# Idle Cost: $0.00/month (Scale-to-zero consumes 0 compute units when inactive).
# ==============================================================================

set -euo pipefail

# ----------------- Configuration Defaults -----------------
RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-rg-breathe-earth-jukebox}"
LOCATION="${AZURE_LOCATION:-southeastasia}" # Choice: southeastasia, eastus, westeurope
ACR_NAME="${ACR_NAME:-acrbreathe$RANDOM}"
ENVIRONMENT_NAME="${CONTAINERAPPS_ENVIRONMENT:-cae-breathe}"
BACKEND_APP_NAME="breathe-backend"
FRONTEND_APP_NAME="breathe-frontend"
export CATALOG_SHARE_NAME="geos-cf-catalog"
export CATALOG_MOUNT_PATH="/app/data/geos-cf-catalog"
STORAGE_ACCOUNT="${AZURE_STORAGE_ACCOUNT:-}"

# Database Configuration (Neon Serverless PostgreSQL)
DATABASE_URL="${DATABASE_URL:-}"
DATABASE_URL_UNPOOLED="${DATABASE_URL_UNPOOLED:-}"

echo "=========================================================="
echo " Starting BREATHE Deployment to Azure Container Apps"
echo " Resource Group: ${RESOURCE_GROUP}"
echo " Location:       ${LOCATION}"
echo " ACR Name:       ${ACR_NAME}"
echo " Scale Policy:   minReplicas=0 (Scale-to-Zero on idle)"
echo "=========================================================="

# Check for Azure CLI
if ! command -v az &> /dev/null; then
    echo "Error: Azure CLI ('az') is not installed. Please install Azure CLI or run this inside Azure Cloud Shell (https://shell.azure.com)." >&2
    exit 1
fi

# 1. Login & Extension Check
echo "Checking Azure login status..."
az account show > /dev/null 2>&1 || az login

echo "Ensuring 'containerapp' extension is installed..."
az extension add --name containerapp --upgrade --yes

# 2. Create Resource Group
echo "Creating Resource Group: ${RESOURCE_GROUP}..."
az group create --name "${RESOURCE_GROUP}" --location "${LOCATION}" --output table

# 3. Create Azure Container Registry (Basic SKU for low cost)
echo "Creating Azure Container Registry: ${ACR_NAME}..."
az acr create \
    --resource-group "${RESOURCE_GROUP}" \
    --name "${ACR_NAME}" \
    --sku Basic \
    --admin-enabled true \
    --output table

ACR_LOGIN_SERVER=$(az acr show --name "${ACR_NAME}" --query loginServer -o tsv)
ACR_PASSWORD=$(az acr credential show --name "${ACR_NAME}" --query "passwords[0].value" -o tsv)

# 4. Build Images directly in Cloud using ACR Build (no local Docker required)
echo "Building Backend Container Image using ACR Cloud Build..."
az acr build \
    --registry "${ACR_NAME}" \
    --image "${BACKEND_APP_NAME}:latest" \
    --file ./backend/Dockerfile \
    ./backend

echo "Building Frontend Container Image using ACR Cloud Build..."
az acr build \
    --registry "${ACR_NAME}" \
    --image "${FRONTEND_APP_NAME}:latest" \
    --file ./frontend/Dockerfile \
    ./frontend

# 5. Create Container Apps Managed Environment
echo "Creating Azure Container Apps Environment: ${ENVIRONMENT_NAME}..."
az containerapp env create \
    --name "${ENVIRONMENT_NAME}" \
    --resource-group "${RESOURCE_GROUP}" \
    --location "${LOCATION}" \
    --output table

# 5b. Provision Azure File Share & bind ReadOnly catalog storage to Container Apps Environment
STORAGE_ACCOUNT=$(AZURE_STORAGE_ACCOUNT="${STORAGE_ACCOUNT}" bash "$(dirname "$0")/ensure-azure-catalog-storage.sh" "${RESOURCE_GROUP}" "${LOCATION}" "${CATALOG_SHARE_NAME}")
STORAGE_KEY=$(az storage account keys list --account-name "${STORAGE_ACCOUNT}" --resource-group "${RESOURCE_GROUP}" --query "[0].value" -o tsv)
az containerapp env storage set \
    --name "${ENVIRONMENT_NAME}" \
    --resource-group "${RESOURCE_GROUP}" \
    --storage-name "${CATALOG_SHARE_NAME}" \
    --azure-file-account-name "${STORAGE_ACCOUNT}" \
    --azure-file-account-key "${STORAGE_KEY}" \
    --azure-file-share-name "${CATALOG_SHARE_NAME}" \
    --access-mode ReadOnly \
    --output none

# 6. Deploy Backend Container App (Scale-to-Zero: min-replicas 0)
echo "Deploying Backend Container App (${BACKEND_APP_NAME})..."
az containerapp create \
    --name "${BACKEND_APP_NAME}" \
    --resource-group "${RESOURCE_GROUP}" \
    --environment "${ENVIRONMENT_NAME}" \
    --image "${ACR_LOGIN_SERVER}/${BACKEND_APP_NAME}:latest" \
    --registry-server "${ACR_LOGIN_SERVER}" \
    --registry-username "${ACR_NAME}" \
    --registry-password "${ACR_PASSWORD}" \
    --target-port 8000 \
    --ingress external \
    --min-replicas 0 \
    --max-replicas 2 \
    --cpu 0.5 \
    --memory 1.0Gi \
    --env-vars \
        HOST="0.0.0.0" \
        PORT="8000" \
        ENVIRONMENT="production" \
        DEBUG="False" \
        GEOS_CF_CATALOG_ROOT="${CATALOG_MOUNT_PATH}" \
        DATABASE_URL="${DATABASE_URL}" \
        DATABASE_URL_UNPOOLED="${DATABASE_URL_UNPOOLED}" \
    --output table

CATALOG_PATCH_YAML=$(mktemp /tmp/breathe-backend-mount-XXXXXX.yaml)
trap 'rm -f "${CATALOG_PATCH_YAML}"' EXIT
az containerapp show --name "${BACKEND_APP_NAME}" --resource-group "${RESOURCE_GROUP}" -o json | python3 -c '
import json, os, sys
app = json.load(sys.stdin)
props = app.get("properties") or {}
template = props.get("template") or {}
share = os.environ["CATALOG_SHARE_NAME"]
mount_path = os.environ["CATALOG_MOUNT_PATH"]
volumes = [v for v in (template.get("volumes") or []) if v.get("name") != share]
volumes.append({"name": share, "storageType": "AzureFile", "storageName": share})
template["volumes"] = volumes
containers = template.get("containers") or []
if not containers:
    raise SystemExit("Backend container definition missing")
mounts = [m for m in (containers[0].get("volumeMounts") or []) if m.get("volumeName") != share and m.get("mountPath") != mount_path]
mounts.append({"volumeName": share, "mountPath": mount_path})
containers[0]["volumeMounts"] = mounts
payload = {"properties": {"managedEnvironmentId": props["managedEnvironmentId"], "template": {k: v for k, v in template.items() if k != "revisionSuffix" and v is not None}}}
with open(sys.argv[1], "w", encoding="utf-8") as fh:
    json.dump(payload, fh, indent=2)
' "${CATALOG_PATCH_YAML}"
CATALOG_SHARE_NAME="${CATALOG_SHARE_NAME}" CATALOG_MOUNT_PATH="${CATALOG_MOUNT_PATH}" az containerapp update \
    --name "${BACKEND_APP_NAME}" \
    --resource-group "${RESOURCE_GROUP}" \
    --yaml "${CATALOG_PATCH_YAML}" \
    --output none

BACKEND_FQDN=$(az containerapp show --name "${BACKEND_APP_NAME}" --resource-group "${RESOURCE_GROUP}" --query "properties.configuration.ingress.fqdn" -o tsv)
BACKEND_URL="https://${BACKEND_FQDN}"
echo "Backend deployed at: ${BACKEND_URL}"

# 7. Deploy Frontend Container App (Scale-to-Zero: min-replicas 0)
echo "Deploying Frontend Container App (${FRONTEND_APP_NAME})..."
az containerapp create \
    --name "${FRONTEND_APP_NAME}" \
    --resource-group "${RESOURCE_GROUP}" \
    --environment "${ENVIRONMENT_NAME}" \
    --image "${ACR_LOGIN_SERVER}/${FRONTEND_APP_NAME}:latest" \
    --registry-server "${ACR_LOGIN_SERVER}" \
    --registry-username "${ACR_NAME}" \
    --registry-password "${ACR_PASSWORD}" \
    --target-port 3000 \
    --ingress external \
    --min-replicas 0 \
    --max-replicas 3 \
    --cpu 0.5 \
    --memory 1.0Gi \
    --env-vars \
        NODE_ENV="production" \
        PORT="3000" \
        NEXT_PUBLIC_API_URL="${BACKEND_URL}" \
        DATABASE_URL="${DATABASE_URL}" \
        DATABASE_URL_UNPOOLED="${DATABASE_URL_UNPOOLED}" \
    --output table

FRONTEND_FQDN=$(az containerapp show --name "${FRONTEND_APP_NAME}" --resource-group "${RESOURCE_GROUP}" --query "properties.configuration.ingress.fqdn" -o tsv)
FRONTEND_URL="https://${FRONTEND_FQDN}"

# 8. Update Backend CORS to allow Frontend URL
echo "Updating Backend CORS origins to allow Frontend URL..."
az containerapp update \
    --name "${BACKEND_APP_NAME}" \
    --resource-group "${RESOURCE_GROUP}" \
    --set-env-vars \
        CORS_ORIGINS="[\"${FRONTEND_URL}\",\"http://localhost:3000\"]" \
    --output table

echo ""
echo "=========================================================="
echo " Deployment Successfully Completed!"
echo " Frontend URL: ${FRONTEND_URL}"
echo " Backend URL:  ${BACKEND_URL}"
echo " Database:     Neon PostgreSQL (Serverless)"
echo " Cost Policy:  Active Scale-to-Zero (minReplicas = 0)"
echo "=========================================================="
