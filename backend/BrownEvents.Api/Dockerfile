# Multi-stage build
# Stage 1: build
FROM mcr.microsoft.com/dotnet/sdk:6.0 AS build
WORKDIR /src

COPY BrownEvents.sln ./
COPY BrownEvents.Api/BrownEvents.Api.csproj BrownEvents.Api/
COPY BrownEvents.Tests/BrownEvents.Tests.csproj BrownEvents.Tests/
RUN dotnet restore BrownEvents.sln

COPY . .
RUN dotnet publish BrownEvents.Api/BrownEvents.Api.csproj -c Release -o /app/publish

# Stage 2: runtime
FROM mcr.microsoft.com/dotnet/aspnet:6.0 AS runtime
WORKDIR /app
COPY --from=build /app/publish .
EXPOSE 80
ENTRYPOINT ["dotnet", "BrownEvents.Api.dll"]
