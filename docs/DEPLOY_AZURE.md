# Triển Khai BREATHE Lên Azure Container Apps (CI/CD Tự Động)

> **Mô hình hoạt động:** Tương tự như AlgoViz, quy trình triển khai của BREATHE được tự động hóa hoàn toàn thông qua GitHub Actions (`.github/workflows/breathe-ci-cd.yml`):
> 1. Mọi **Pull Request** vào nhánh `main` được kiểm tra tự động qua bộ test Backend (`pytest`) và Frontend (`eslint`, `tsc`, `next build`).
> 2. Khi **Merge vào `main`**, hệ thống tự động build Docker images, đẩy lên Azure Container Registry (ACR), và triển khai/cập nhật Azure Container Apps (`breathe-backend` & `breathe-frontend`) với chính sách **Scale-to-Zero ($0 idle)**.

---

## 1. Danh Sách Secrets Cần Thiết Trên GitHub

Vào repository GitHub: **Settings $\rightarrow$ Secrets and variables $\rightarrow$ Actions** và thêm các Repository Secrets sau:

| Tên Secret | Mô tả | Ví dụ giá trị |
| :--- | :--- | :--- |
| `AZURE_CREDENTIALS` | JSON Service Principal cấp quyền cho GitHub Actions | `{"clientId": "...", "clientSecret": "...", ...}` |
| `AZURE_RESOURCE_GROUP` | Tên Resource Group trên Azure | `rg-breathe-earth-jukebox` |
| `ACR_LOGIN_SERVER` | Địa chỉ máy chủ ACR | `ca951f3ca84aacr.azurecr.io` |
| `ACR_USERNAME` | Username admin của ACR | `ca951f3ca84aacr` |
| `ACR_PASSWORD` | Password admin của ACR | Lấy từ `az acr credential show` |
| `DATABASE_URL` | Chuỗi kết nối Neon PostgreSQL (Pooled) | `postgresql://neondb_owner:...@ep-....aws.neon.tech/neondb?sslmode=require` |
| `DATABASE_URL_UNPOOLED` | Chuỗi kết nối Neon PostgreSQL (Unpooled) | `postgresql://neondb_owner:...@ep-....aws.neon.tech/neondb?sslmode=require` |

---

## 2. Hướng Dẫn Lấy Giá Trị Trên Azure Cloud Shell

### Bước 1: Tạo Resource Group riêng cho BREATHE
```bash
ALLOWED_LOCATION=$(az group show -n rg-algoviz --query location -o tsv)
az group create --name rg-breathe-earth-jukebox --location "$ALLOWED_LOCATION"
```

### Bước 2: Tạo Azure Service Principal cho GitHub Actions
```bash
SUBSCRIPTION_ID=$(az account show --query id -o tsv)

az ad sp create-for-rbac \
  --name "breathe-github-actions" \
  --role "Contributor" \
  --scopes "/subscriptions/${SUBSCRIPTION_ID}/resourceGroups/rg-breathe-earth-jukebox" \
  --json-auth
```
*Sao chép toàn bộ đoạn JSON in ra dán vào secret `AZURE_CREDENTIALS`.*

### Bước 3: Lấy thông tin đăng nhập ACR
```bash
# Thay ca951f3ca84aacr bằng tên ACR của bạn
az acr credential show -n ca951f3ca84aacr -o table
```

---

## 3. Quy Trình Hoạt Động Của CI/CD

```mermaid
flowchart TD
    PR["Pull Request -> main"] --> CI["CI Test Suite"]
    CI --> B_TEST["Backend: pytest, NetCDF, uv"]
    CI --> F_TEST["Frontend: lint, tsc, next build"]
    B_TEST --> PASS{"All Pass?"}
    F_TEST --> PASS
    PASS -- "Yes" --> GREEN["Green Status / Cho phép Merge"]

    MERGE["Merge to main"] --> CI_MAIN["CI Validation"]
    CI_MAIN --> CD["CD Production Deploy"]
    CD --> DOCKER["Build & Push Images to ACR"]
    DOCKER --> ACA["Deploy/Update Azure Container Apps"]
    ACA --> LIVE["Live Production URL (Scale-to-Zero)"]
```

- **Scale-to-Zero:** Cả Frontend và Backend đều cấu hình `minReplicas = 0`. Khi không có request, số instance giảm về 0 và tiêu tốn **$0.00 chi phí tính toán**.
- **Tự động gắn Backend URL:** Frontend Container App tự động nhận biến `NEXT_PUBLIC_API_URL` trỏ trực tiếp đến FQDN của Backend Container App.
