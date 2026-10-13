# Portal deployment resilience

The production portal deploy should treat Azure Container Apps updates as asynchronous operations. A CLI timeout does not necessarily mean the image update failed.

Required release behaviour:
- wait until the Container App provisioning state is `Succeeded` before mutating it;
- retry the image update when Azure reports a timeout/busy state;
- after a timeout, check whether the target image is already recorded before retrying;
- wait until provisioning returns to `Succeeded` after the update;
- verify the configured image is the expected GitHub SHA;
- verify the portal returns HTTP 200;
- verify the direct Azure API origin `https://slh-tms-api-prod.azurewebsites.net/api/v1/health` returns API health. Azure Static Web Apps does not provide the local Docker Nginx `/tms-api` reverse proxy.

This avoids false failed releases when `az containerapp update` returns before the Azure control-plane operation has fully settled.
