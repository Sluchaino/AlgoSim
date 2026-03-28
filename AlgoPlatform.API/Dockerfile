# ===== build =====
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY . .

# ВАЖНО: путь на твой реальный веб-проект
RUN dotnet restore ./AlgoPlatform/AlgoPlatform.csproj
RUN dotnet publish ./AlgoPlatform/AlgoPlatform.csproj -c Release -o /app /p:UseAppHost=false

# ===== runtime =====
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app .

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgssapi-krb5-2 \
    && rm -rf /var/lib/apt/lists/*

# Слушаем в контейнере на 0.0.0.0
ENV ASPNETCORE_URLS=http://0.0.0.0:5280
EXPOSE 5280

# DLL берётся из имени проекта (AlgoPlatform.csproj -> AlgoPlatform.dll)
ENTRYPOINT ["dotnet","AlgoPlatform.dll"]
