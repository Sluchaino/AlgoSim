# ===== build =====
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src
COPY . .

# ВАЖНО: путь на твой реальный веб-проект
RUN dotnet restore ./AlgoPlatform/AlgoPlatform.csproj
RUN dotnet publish ./AlgoPlatform/AlgoPlatform.csproj -c Release -o /app /p:UseAppHost=false

# ===== runtime =====
FROM mcr.microsoft.com/dotnet/aspnet:9.0
WORKDIR /app
COPY --from=build /app .

# Слушаем в контейнере на 0.0.0.0
ENV ASPNETCORE_URLS=http://0.0.0.0:5280
EXPOSE 5280

# DLL берётся из имени проекта (AlgoPlatform.csproj -> AlgoPlatform.dll)
ENTRYPOINT ["dotnet","AlgoPlatform.dll"]