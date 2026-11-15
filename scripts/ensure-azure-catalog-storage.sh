#!/usr/bin/env bash
# Provision or discover the Azure Storage Account and File Share for the verified GEOS-CF catalog.
set -euo pipefail

RESOURCE_GROUP="${1:?Usage: ensure-azure-catalog-storage.sh <resource-group> [location] [share-name]}"
RAW_LOCATION="${2:-eastasia}"
CATALOG_SHARE_NAME="${3:-geos-cf-catalog}"
CATALOG_LOCATION="$(printf '%s' "${RAW_LOCATION}" | tr '[:upper:]' '[:lower:]' | tr -d ' ')"
STORAGE_ACCOUNT="${AZURE_STORAGE_ACCOUNT:-}"

SUB_INFO=$(az account show --query "[id,state]" -o tsv 2>/dev/null || echo "")
echo "Active Azure subscription check: ${SUB_INFO:-unknown}" >&2

if [ -z "${STORAGE_ACCOUNT}" ]; then
  STORAGE_ACCOUNT=$(az storage account list --resource-group "${RESOURCE_GROUP}" --query "[?starts_with(name, 'stbreathe')].name | [0]" -o tsv 2>/dev/null || echo "")
fi
if [ -z "${STORAGE_ACCOUNT}" ]; then
  STORAGE_ACCOUNT=$(az storage account list --resource-group "${RESOURCE_GROUP}" --query "[0].name" -o tsv 2>/dev/null || echo "")
fi

if [ -z "${STORAGE_ACCOUNT}" ]; then
  PROVIDER_STATE=$(az provider show --namespace Microsoft.Storage --query registrationState -o tsv 2>/dev/null || echo "")
  if [ "${PROVIDER_STATE}" != "Registered" ]; then
    echo "Microsoft.Storage provider state is '${PROVIDER_STATE:-unknown}'; attempting registration..." >&2
    az provider register --namespace Microsoft.Storage --wait >/dev/null 2>&1 || true
  fi

  STORAGE_ACCOUNT="stbreathe$(printf '%s' "${RESOURCE_GROUP}" | sha256sum | cut -c1-12)"
  echo "Creating Azure Storage Account (${STORAGE_ACCOUNT}) in ${CATALOG_LOCATION}..." >&2
  if ! az storage account create \
    --name "${STORAGE_ACCOUNT}" \
    --resource-group "${RESOURCE_GROUP}" \
    --location "${CATALOG_LOCATION}" \
    --sku Standard_LRS \
    --kind StorageV2 \
    --min-tls-version TLS1_2 \
    --allow-blob-public-access false \
    --output none; then
    echo "Retrying storage account creation via resource-group ARM API..." >&2
    az resource create \
      --resource-group "${RESOURCE_GROUP}" \
      --resource-type Microsoft.Storage/storageAccounts \
      --name "${STORAGE_ACCOUNT}" \
      --location "${CATALOG_LOCATION}" \
      --api-version 2023-05-01 \
      --is-full-object \
      --properties '{"sku":{"name":"Standard_LRS"},"kind":"StorageV2","properties":{"minimumTlsVersion":"TLS1_2","allowBlobPublicAccess":false}}' \
      --output none
  fi
else
  echo "Reusing Azure Storage Account: ${STORAGE_ACCOUNT}" >&2
fi

STORAGE_KEY=$(az storage account keys list --account-name "${STORAGE_ACCOUNT}" --resource-group "${RESOURCE_GROUP}" --query "[0].value" -o tsv)
az storage share create \
  --name "${CATALOG_SHARE_NAME}" \
  --account-name "${STORAGE_ACCOUNT}" \
  --account-key "${STORAGE_KEY}" \
  --quota 10 \
  --output none

printf '%s\n' "${STORAGE_ACCOUNT}"
